import { getDatabase, runExclusiveTransaction } from './client';
import type {
  BudgetCategoryInput,
  BudgetCategoryRow,
  BudgetRow,
  CreateBudgetInput,
  DatabaseConnection,
} from './types';
import { assertCivilDate } from '../domain/civil-date';
import { calculateBudgetAmounts, calculateUnallocated, calculateUnspentRollover } from '../domain/budget';
import { FinancialIntegrityError, toFinancialBigInt, toSafeFinancialNumber } from '../domain/integer-math';
import { isSupportedCurrency } from '../domain/money';

const DEBT_EXPENSE_CATEGORIES = new Set(['cat_exp_loan_given', 'cat_exp_loan_repayment']);
const DEBT_INCOME_CATEGORIES = new Set(['cat_inc_loan_received', 'cat_inc_loan_repayment_received']);

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeCurrency(currency: string): string {
  const value = currency.trim().toUpperCase();
  if (!isSupportedCurrency(value)) throw new Error('BUDGET_ERR_INVALID_CURRENCY');
  return value;
}

function assertPositiveOptional(value: number | null | undefined, label: string): void {
  if (value != null && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

async function assertNoOverlap(
  db: DatabaseConnection,
  input: { startsOn: string; endsOn: string; currency: string; accountId: string | null },
  excludingId?: string
): Promise<void> {
  const params: unknown[] = [input.currency, input.startsOn, input.endsOn];
  let excluding = '';
  if (excludingId) {
    excluding = 'AND id <> ?';
    params.push(excludingId);
  }
  const rows = await db.getAllAsync<{ account_id: string | null }>(
    `SELECT account_id FROM budgets
     WHERE currency = ? AND starts_on <= ? AND ends_on >= ?
       AND archived_at IS NULL AND deleted_at IS NULL ${excluding};`,
    ...params
  );
  if (rows.some((row) => row.account_id === null || input.accountId === null || row.account_id === input.accountId)) {
    throw new Error('BUDGET_ERR_OVERLAPPING_SCOPE');
  }
}

async function validateCategories(
  db: DatabaseConnection,
  categories: readonly BudgetCategoryInput[],
  expenseLimit: number | null
): Promise<void> {
  const seen = new Set<string>();
  for (const item of categories) {
    if (seen.has(item.categoryId)) throw new Error('BUDGET_ERR_DUPLICATE_CATEGORY');
    seen.add(item.categoryId);
    if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0) {
      throw new Error('BUDGET_ERR_INVALID_CATEGORY_AMOUNT');
    }
    const category = await db.getFirstAsync<{ type: string; is_archived: number }>(
      'SELECT type,is_archived FROM categories WHERE id = ?;', item.categoryId
    );
    if (!category || category.type !== 'expense') throw new Error('BUDGET_ERR_EXPENSE_CATEGORY_REQUIRED');
    if (category.is_archived === 1) throw new Error('BUDGET_ERR_CATEGORY_ARCHIVED');
  }
  if (expenseLimit !== null) calculateUnallocated(expenseLimit, categories.map((item) => item.amountMinor));
}

async function validateRollover(
  db: DatabaseConnection,
  sourceId: string | null,
  destination: { id?: string; startsOn: string; currency: string; accountId: string | null }
): Promise<void> {
  if (!sourceId) return;
  if (sourceId === destination.id) throw new Error('BUDGET_ERR_ROLLOVER_CYCLE');
  const source = await db.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id = ? AND deleted_at IS NULL;', sourceId);
  if (!source || source.archived_at !== null) throw new Error('BUDGET_ERR_INVALID_ROLLOVER_SOURCE');
  if (source.currency !== destination.currency || source.account_id !== destination.accountId || source.ends_on >= destination.startsOn) {
    throw new Error('BUDGET_ERR_INVALID_ROLLOVER_SOURCE');
  }
  const visited = new Set<string>(destination.id ? [destination.id] : []);
  let cursor: BudgetRow | null = source;
  while (cursor) {
    if (visited.has(cursor.id)) throw new Error('BUDGET_ERR_ROLLOVER_CYCLE');
    visited.add(cursor.id);
    cursor = cursor.rollover_from_budget_id
      ? await db.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id = ?;', cursor.rollover_from_budget_id)
      : null;
  }
}

async function hasQualifyingActivity(db: DatabaseConnection, budget: BudgetRow): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT t.id
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE t.deleted_at IS NULL
       AND t.type IN ('income','expense')
       AND t.occurred_on BETWEEN ? AND ?
       AND a.currency = ?
       AND (? IS NULL OR t.account_id = ?)
     LIMIT 1;`,
    budget.starts_on, budget.ends_on, budget.currency, budget.account_id, budget.account_id
  );
  return Boolean(row);
}

function assertBudgetMutable(budget: BudgetRow): void {
  if (budget.deleted_at !== null) throw new Error('BUDGET_ERR_DELETED');
  if (budget.archived_at !== null) throw new Error('BUDGET_ERR_ARCHIVED');
}

async function assertBudgetMeaningful(db: DatabaseConnection, budget: BudgetRow, excludingCategoryId?: string): Promise<void> {
  if (budget.income_target !== null || budget.expense_limit !== null) return;
  const other = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM budget_categories
     WHERE budget_id=? AND deleted_at IS NULL ${excludingCategoryId ? 'AND id<>?' : ''}
     LIMIT 1;`,
    ...(excludingCategoryId ? [budget.id, excludingCategoryId] : [budget.id])
  );
  if (!other) throw new Error('BUDGET_ERR_TARGET_REQUIRED');
}

async function insertBudget(
  db: DatabaseConnection,
  input: CreateBudgetInput,
  now: number,
  budgetId: string
): Promise<void> {
  assertCivilDate(input.startsOn, 'startsOn');
  assertCivilDate(input.endsOn, 'endsOn');
  if (input.endsOn < input.startsOn) throw new Error('BUDGET_ERR_INVALID_PERIOD');
  const currency = normalizeCurrency(input.currency);
  const accountId = input.accountId ?? null;
  const incomeTarget = input.incomeTargetMinor ?? null;
  const expenseLimit = input.expenseLimitMinor ?? null;
  const categories = input.categories ?? [];
  assertPositiveOptional(incomeTarget, 'income target');
  assertPositiveOptional(expenseLimit, 'expense limit');
  if (incomeTarget === null && expenseLimit === null && categories.length === 0) {
    throw new Error('BUDGET_ERR_TARGET_REQUIRED');
  }
  if (input.periodType !== 'monthly' && input.periodType !== 'custom') throw new Error('BUDGET_ERR_INVALID_PERIOD_TYPE');
  if (accountId) {
    const account = await db.getFirstAsync<{ currency: string; archived_at: number | null }>(
      'SELECT currency, archived_at FROM accounts WHERE id = ?;', accountId
    );
    if (!account || account.archived_at !== null) throw new Error('BUDGET_ERR_ACCOUNT_UNAVAILABLE');
    if (account.currency !== currency) throw new Error('BUDGET_ERR_CURRENCY_MISMATCH');
  }
  await validateCategories(db, categories, expenseLimit);
  await assertNoOverlap(db, { startsOn: input.startsOn, endsOn: input.endsOn, currency, accountId });
  const rolloverPolicy = input.rolloverPolicy ?? 'none';
  const rolloverSource = input.rolloverFromBudgetId ?? null;
  if (rolloverPolicy === 'none' && rolloverSource !== null) throw new Error('BUDGET_ERR_UNEXPECTED_ROLLOVER_SOURCE');
  if (rolloverPolicy === 'unspent_only' && (!rolloverSource || expenseLimit === null)) {
    throw new Error('BUDGET_ERR_ROLLOVER_SOURCE_REQUIRED');
  }
  await validateRollover(db, rolloverSource, { startsOn: input.startsOn, currency, accountId });
  await db.runAsync(
    `INSERT INTO budgets (id,name,period_type,starts_on,ends_on,currency,account_id,income_target,
      expense_limit,rollover_policy,rollover_from_budget_id,note,created_at,updated_at,archived_at,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL);`,
    budgetId, input.name?.trim() || null, input.periodType, input.startsOn, input.endsOn, currency,
    accountId, incomeTarget, expenseLimit, rolloverPolicy, rolloverSource, input.note?.trim() || null, now, now
  );
  for (const [index, item] of categories.entries()) {
    await db.runAsync(
      `INSERT INTO budget_categories (id,budget_id,category_id,amount,sort_order,created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,NULL);`,
      id('bcat'), budgetId, item.categoryId, item.amountMinor, item.sortOrder ?? index, now, now
    );
  }
}

export async function createBudget(input: CreateBudgetInput, customDb?: DatabaseConnection): Promise<BudgetRow> {
  const db = customDb ?? (await getDatabase());
  const budgetId = id('budget');
  await runExclusiveTransaction(db, (txn) => insertBudget(txn, input, Date.now(), budgetId));
  return (await getBudgetById(budgetId, db))!;
}

export async function getBudgetById(idValue: string, customDb?: DatabaseConnection): Promise<BudgetRow | null> {
  const db = customDb ?? (await getDatabase());
  return db.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id = ?;', idValue);
}

export async function getBudgetCategories(budgetId: string, customDb?: DatabaseConnection): Promise<BudgetCategoryRow[]> {
  const db = customDb ?? (await getDatabase());
  return db.getAllAsync<BudgetCategoryRow>(
    'SELECT * FROM budget_categories WHERE budget_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at;',
    budgetId
  );
}

export async function getBudgets(
  filter: { currency?: string; archived?: boolean; includeDeleted?: boolean } = {},
  customDb?: DatabaseConnection
): Promise<BudgetRow[]> {
  const db = customDb ?? (await getDatabase());
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!filter.includeDeleted) conditions.push('deleted_at IS NULL');
  if (filter.archived !== undefined) conditions.push(filter.archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL');
  if (filter.currency) { conditions.push('currency = ?'); params.push(normalizeCurrency(filter.currency)); }
  return db.getAllAsync<BudgetRow>(
    `SELECT * FROM budgets ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY starts_on DESC, created_at DESC;`,
    ...params
  );
}

export interface BudgetActualRow {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category_id: string;
  debt_role: string | null;
  debt_direction: string | null;
  occurred_on: string;
  note: string | null;
}

function assertDebtMetadata(row: BudgetActualRow): void {
  const expected: Record<string, [string, string]> = {
    cat_exp_loan_given: ['disbursement', 'lent'],
    cat_exp_loan_repayment: ['repayment', 'borrowed'],
    cat_inc_loan_received: ['disbursement', 'borrowed'],
    cat_inc_loan_repayment_received: ['repayment', 'lent'],
  };
  const semantic = expected[row.category_id];
  if ((!semantic && row.debt_role) || (semantic && (!row.debt_role || semantic[0] !== row.debt_role || semantic[1] !== row.debt_direction))) {
    throw new FinancialIntegrityError(`Debt metadata disagrees with transaction ${row.id}.`);
  }
}

export interface BudgetPerformance {
  budget: BudgetRow;
  categories: (BudgetCategoryRow & { actual: number; remaining: number })[];
  incomeActual: number;
  overallActual: number;
  actualOutsideAllocatedCategories: number;
  rollover: number;
  effectiveExpenseLimit: number | null;
  remaining: number | null;
  overspent: number;
  unallocated: number | null;
  progressBp: number | null;
  transactions: BudgetActualRow[];
}

export async function getBudgetPerformance(
  budgetId: string,
  customDb?: DatabaseConnection,
  visited: Set<string> = new Set()
): Promise<BudgetPerformance> {
  const db = customDb ?? (await getDatabase());
  const budget = await getBudgetById(budgetId, db);
  if (!budget || budget.deleted_at !== null) throw new Error('BUDGET_ERR_NOT_FOUND');
  if (visited.has(budget.id)) throw new FinancialIntegrityError('Budget rollover cycle detected.');
  visited.add(budget.id);
  const categories = await getBudgetCategories(budget.id, db);
  const rows = await db.getAllAsync<BudgetActualRow>(
    `SELECT t.id,t.type,t.amount,t.category_id,t.occurred_on,t.note,dt.role AS debt_role,d.direction AS debt_direction
     FROM transactions t
     JOIN accounts a ON a.id=t.account_id
     LEFT JOIN debt_transactions dt ON dt.transaction_id=t.id AND dt.deleted_at IS NULL
     LEFT JOIN debts d ON d.id=dt.debt_id AND d.deleted_at IS NULL
     WHERE t.deleted_at IS NULL AND t.type IN ('income','expense')
       AND t.occurred_on BETWEEN ? AND ? AND a.currency = ?
       AND (? IS NULL OR t.account_id = ?);`,
    budget.starts_on, budget.ends_on, budget.currency, budget.account_id, budget.account_id
  );
  const allocatedIds = new Set(categories.map((item) => item.category_id));
  const categoryTotals = new Map<string, bigint>();
  let incomeActual = 0n;
  let overallActual = 0n;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.amount) || row.amount <= 0) throw new FinancialIntegrityError(`Unsafe transaction ${row.id}.`);
    assertDebtMetadata(row);
    const amount = toFinancialBigInt(row.amount, `transaction ${row.id}`);
    if (row.type === 'income') {
      if (!DEBT_INCOME_CATEGORIES.has(row.category_id)) incomeActual += amount;
      continue;
    }
    const debtPrincipal = DEBT_EXPENSE_CATEGORIES.has(row.category_id);
    if (!debtPrincipal || allocatedIds.has(row.category_id)) overallActual += amount;
    if (allocatedIds.has(row.category_id)) {
      categoryTotals.set(row.category_id, (categoryTotals.get(row.category_id) ?? 0n) + amount);
    }
  }
  const overallNumber = toSafeFinancialNumber(overallActual, 'overall budget actual');
  const categoryResults = categories.map((category) => {
    const actual = toSafeFinancialNumber(categoryTotals.get(category.category_id) ?? 0n, 'category actual');
    return { ...category, actual, remaining: toSafeFinancialNumber(toFinancialBigInt(category.amount, 'category plan') - BigInt(actual), 'category remaining') };
  });
  const allocatedActual = categoryResults.reduce((sum, item) => sum + BigInt(item.actual), 0n);
  if (allocatedActual > overallActual) throw new FinancialIntegrityError('Category actuals exceed the reconciled overall actual.');
  let rollover = 0;
  if (budget.rollover_policy === 'unspent_only' && budget.rollover_from_budget_id) {
    const previous = await getBudgetPerformance(budget.rollover_from_budget_id, db, visited);
    if (previous.effectiveExpenseLimit === null) throw new FinancialIntegrityError('Rollover source has no expense limit.');
    rollover = calculateUnspentRollover(previous.effectiveExpenseLimit, previous.overallActual);
  }
  const amounts = budget.expense_limit === null
    ? null
    : calculateBudgetAmounts({ planned: budget.expense_limit, rollover, actual: overallNumber });
  return {
    budget,
    categories: categoryResults,
    incomeActual: toSafeFinancialNumber(incomeActual, 'income excluding debt principal'),
    overallActual: overallNumber,
    actualOutsideAllocatedCategories: toSafeFinancialNumber(overallActual - allocatedActual, 'actual outside allocations'),
    rollover,
    effectiveExpenseLimit: amounts?.effectiveLimit ?? null,
    remaining: amounts?.remaining ?? null,
    overspent: amounts?.overspent ?? 0,
    unallocated: budget.expense_limit === null ? null : calculateUnallocated(budget.expense_limit, categories.map((item) => item.amount)),
    progressBp: amounts?.progressBp ?? null,
    transactions: rows,
  };
}

export async function archiveBudget(budgetId: string, customDb?: DatabaseConnection): Promise<void> {
  const db = customDb ?? (await getDatabase());
  await runExclusiveTransaction(db, async (txn) => {
    const budget = await txn.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id=?;', budgetId);
    if (!budget || budget.deleted_at !== null) throw new Error('BUDGET_ERR_NOT_FOUND');
    if (budget.archived_at !== null) return;
    await assertBudgetMeaningful(txn, budget);
    const now = Date.now();
    await txn.runAsync('UPDATE budgets SET archived_at=?,updated_at=? WHERE id=?;', now, now, budgetId);
  });
}

export async function restoreArchivedBudget(budgetId: string, customDb?: DatabaseConnection): Promise<void> {
  const db = customDb ?? (await getDatabase());
  await runExclusiveTransaction(db, async (txn) => {
    const budget = await txn.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id=? AND deleted_at IS NULL;', budgetId);
    if (!budget) throw new Error('BUDGET_ERR_NOT_FOUND');
    if (budget.archived_at === null) return;
    if (budget.account_id) {
      const account = await txn.getFirstAsync<{ currency: string; archived_at: number | null }>('SELECT currency,archived_at FROM accounts WHERE id=?;', budget.account_id);
      if (!account || account.archived_at !== null) throw new Error('BUDGET_ERR_ACCOUNT_UNAVAILABLE');
      if (account.currency !== budget.currency) throw new Error('BUDGET_ERR_CURRENCY_MISMATCH');
    }
    await assertBudgetMeaningful(txn, budget);
    const categories = await getBudgetCategories(budget.id, txn);
    await validateCategories(txn, categories.map((item) => ({ categoryId: item.category_id, amountMinor: item.amount, sortOrder: item.sort_order })), budget.expense_limit);
    await validateRollover(txn, budget.rollover_from_budget_id, { id: budget.id, startsOn: budget.starts_on, currency: budget.currency, accountId: budget.account_id });
    await assertNoOverlap(txn, { startsOn: budget.starts_on, endsOn: budget.ends_on, currency: budget.currency, accountId: budget.account_id }, budget.id);
    await txn.runAsync('UPDATE budgets SET archived_at=NULL,updated_at=? WHERE id=?;', Date.now(), budget.id);
  });
}

export async function softDeleteBudget(budgetId: string, customDb?: DatabaseConnection): Promise<void> {
  const db = customDb ?? (await getDatabase());
  await runExclusiveTransaction(db, async (txn) => {
    const budget = await txn.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id=?;', budgetId);
    if (!budget || budget.deleted_at !== null) throw new Error('BUDGET_ERR_NOT_FOUND');
    if (budget.archived_at === null) throw new Error('BUDGET_ERR_ARCHIVE_BEFORE_DELETE');
    if (await hasQualifyingActivity(txn, budget)) throw new Error('BUDGET_ERR_ACTIVITY_LOCKED');
    const now = Date.now();
    await txn.runAsync('UPDATE budgets SET deleted_at=?,updated_at=? WHERE id=?;', now, now, budgetId);
  });
}

export async function duplicateBudget(
  sourceId: string,
  period: { startsOn: string; endsOn: string },
  customDb?: DatabaseConnection
): Promise<BudgetRow> {
  const db = customDb ?? (await getDatabase());
  const source = await getBudgetById(sourceId, db);
  if (!source || source.deleted_at !== null) throw new Error('BUDGET_ERR_NOT_FOUND');
  const categories = await getBudgetCategories(sourceId, db);
  return createBudget({
    name: source.name,
    periodType: source.period_type,
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    currency: source.currency,
    accountId: source.account_id,
    incomeTargetMinor: source.income_target,
    expenseLimitMinor: source.expense_limit,
    rolloverPolicy: source.expense_limit === null ? 'none' : 'unspent_only',
    rolloverFromBudgetId: source.expense_limit === null ? null : source.id,
    note: source.note,
    categories: categories.map((item) => ({ categoryId: item.category_id, amountMinor: item.amount, sortOrder: item.sort_order })),
  }, db);
}

export async function updateBudget(
  budgetId: string,
  input: CreateBudgetInput,
  customDb?: DatabaseConnection
): Promise<BudgetRow> {
  const db = customDb ?? (await getDatabase());
  await runExclusiveTransaction(db, async (txn) => {
    const existing = await txn.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id=?;', budgetId);
    if (!existing) throw new Error('BUDGET_ERR_NOT_FOUND');
    assertBudgetMutable(existing);
    assertCivilDate(input.startsOn, 'startsOn'); assertCivilDate(input.endsOn, 'endsOn');
    if (input.endsOn < input.startsOn) throw new Error('BUDGET_ERR_INVALID_PERIOD');
    if (input.periodType !== 'monthly' && input.periodType !== 'custom') throw new Error('BUDGET_ERR_INVALID_PERIOD_TYPE');
    const currency=normalizeCurrency(input.currency); const accountId=input.accountId??null;
    if (await hasQualifyingActivity(txn, existing) && (input.startsOn !== existing.starts_on || input.endsOn !== existing.ends_on || currency !== existing.currency || accountId !== existing.account_id)) {
      throw new Error('BUDGET_ERR_ACTIVITY_LOCKED_DUPLICATE_AND_ARCHIVE');
    }
    const incomeTarget=input.incomeTargetMinor??null; const expenseLimit=input.expenseLimitMinor??null;
    const categories=input.categories??[];
    assertPositiveOptional(incomeTarget,'income target'); assertPositiveOptional(expenseLimit,'expense limit');
    if (incomeTarget===null&&expenseLimit===null&&categories.length===0) throw new Error('BUDGET_ERR_TARGET_REQUIRED');
    if (accountId) {
      const account=await txn.getFirstAsync<{currency:string;archived_at:number|null}>('SELECT currency,archived_at FROM accounts WHERE id=?;',accountId);
      if (!account||account.archived_at!==null) throw new Error('BUDGET_ERR_ACCOUNT_UNAVAILABLE');
      if (account.currency!==currency) throw new Error('BUDGET_ERR_CURRENCY_MISMATCH');
    }
    await validateCategories(txn,categories,expenseLimit);
    await assertNoOverlap(txn,{startsOn:input.startsOn,endsOn:input.endsOn,currency,accountId},budgetId);
    const rolloverPolicy=input.rolloverPolicy??'none'; const rolloverSource=input.rolloverFromBudgetId??null;
    if (rolloverPolicy==='none'&&rolloverSource!==null) throw new Error('BUDGET_ERR_UNEXPECTED_ROLLOVER_SOURCE');
    if (rolloverPolicy==='unspent_only'&&(!rolloverSource||expenseLimit===null)) throw new Error('BUDGET_ERR_ROLLOVER_SOURCE_REQUIRED');
    await validateRollover(txn,rolloverSource,{id:budgetId,startsOn:input.startsOn,currency,accountId});
    const now=Date.now();
    await txn.runAsync(`UPDATE budgets SET name=?,period_type=?,starts_on=?,ends_on=?,currency=?,account_id=?,income_target=?,expense_limit=?,rollover_policy=?,rollover_from_budget_id=?,note=?,updated_at=? WHERE id=?;`,input.name?.trim()||null,input.periodType,input.startsOn,input.endsOn,currency,accountId,incomeTarget,expenseLimit,rolloverPolicy,rolloverSource,input.note?.trim()||null,now,budgetId);
    const rows=await txn.getAllAsync<BudgetCategoryRow>('SELECT * FROM budget_categories WHERE budget_id=? ORDER BY created_at,id;',budgetId);
    const requested=new Map(categories.map((item,index)=>[item.categoryId,{...item,sortOrder:item.sortOrder??index}]));
    for (const row of rows.filter((item)=>item.deleted_at===null)) {
      const item=requested.get(row.category_id);
      if (!item) await txn.runAsync('UPDATE budget_categories SET deleted_at=?,updated_at=? WHERE id=?;',now,now,row.id);
      else { await txn.runAsync('UPDATE budget_categories SET amount=?,sort_order=?,updated_at=? WHERE id=?;',item.amountMinor,item.sortOrder!,now,row.id); requested.delete(row.category_id); }
    }
    for (const item of requested.values()) {
      const historical=[...rows].reverse().find((row)=>row.category_id===item.categoryId&&row.deleted_at!==null);
      if (historical) await txn.runAsync('UPDATE budget_categories SET amount=?,sort_order=?,deleted_at=NULL,updated_at=? WHERE id=?;',item.amountMinor,item.sortOrder!,now,historical.id);
      else await txn.runAsync('INSERT INTO budget_categories(id,budget_id,category_id,amount,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,NULL);',id('bcat'),budgetId,item.categoryId,item.amountMinor,item.sortOrder!,now,now);
    }
  });
  return (await getBudgetById(budgetId,db))!;
}

export async function softDeleteBudgetCategory(idValue:string,customDb?:DatabaseConnection):Promise<void>{
  const db=customDb??(await getDatabase());
  await runExclusiveTransaction(db,async(txn)=>{
    const row=await txn.getFirstAsync<BudgetCategoryRow>('SELECT * FROM budget_categories WHERE id=? AND deleted_at IS NULL;',idValue);
    if(!row)throw new Error('BUDGET_ERR_CATEGORY_NOT_FOUND');
    const budget=await txn.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id=?;',row.budget_id);
    if(!budget)throw new Error('BUDGET_ERR_NOT_FOUND');
    assertBudgetMutable(budget);
    await assertBudgetMeaningful(txn,budget,row.id);
    const now=Date.now();
    await txn.runAsync('UPDATE budget_categories SET deleted_at=?,updated_at=? WHERE id=?;',now,now,row.id);
    await txn.runAsync('UPDATE budgets SET updated_at=? WHERE id=?;',now,budget.id);
  });
}

export async function restoreBudgetCategory(idValue:string,customDb?:DatabaseConnection):Promise<void>{
  const db=customDb??(await getDatabase());
  await runExclusiveTransaction(db,async(txn)=>{const row=await txn.getFirstAsync<BudgetCategoryRow>('SELECT * FROM budget_categories WHERE id=? AND deleted_at IS NOT NULL;',idValue);if(!row)throw new Error('BUDGET_ERR_CATEGORY_NOT_FOUND');const budget=await txn.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id=?;',row.budget_id);if(!budget)throw new Error('BUDGET_ERR_NOT_FOUND');assertBudgetMutable(budget);const active=await getBudgetCategories(budget.id,txn);if(active.some(item=>item.category_id===row.category_id))throw new Error('BUDGET_ERR_DUPLICATE_CATEGORY');await validateCategories(txn,[...active.map(item=>({categoryId:item.category_id,amountMinor:item.amount,sortOrder:item.sort_order})),{categoryId:row.category_id,amountMinor:row.amount,sortOrder:row.sort_order}],budget.expense_limit);const now=Date.now();await txn.runAsync('UPDATE budget_categories SET deleted_at=NULL,updated_at=? WHERE id=?;',now,row.id);await txn.runAsync('UPDATE budgets SET updated_at=? WHERE id=?;',now,budget.id);});
}

export async function reorderBudgetCategories(budgetId:string,orderedIds:string[],customDb?:DatabaseConnection):Promise<void>{
  const db=customDb??(await getDatabase());
  await runExclusiveTransaction(db,async(txn)=>{const budget=await txn.getFirstAsync<BudgetRow>('SELECT * FROM budgets WHERE id=?;',budgetId);if(!budget)throw new Error('BUDGET_ERR_NOT_FOUND');assertBudgetMutable(budget);const active=await getBudgetCategories(budgetId,txn);if(active.length!==orderedIds.length||new Set(orderedIds).size!==orderedIds.length||orderedIds.some(value=>!active.some(item=>item.id===value)))throw new Error('BUDGET_ERR_INVALID_REORDER');const now=Date.now();for(const [index,value] of orderedIds.entries())await txn.runAsync('UPDATE budget_categories SET sort_order=?,updated_at=? WHERE id=?;',index,now,value);await txn.runAsync('UPDATE budgets SET updated_at=? WHERE id=?;',now,budgetId);});
}
