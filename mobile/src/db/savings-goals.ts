import { getDatabase, runExclusiveTransaction } from './client';
import { createTransferInTransaction } from './transactions';
import type {
  CreateSavingsGoalInput,
  DatabaseConnection,
  GoalEntryInput,
  SavingsGoalEntryRow,
  SavingsGoalLinkMode,
  SavingsGoalRow,
  TransactionRow,
  UpdateSavingsGoalInput,
} from './types';
import { assertCivilDate, localCivilDateFromTimestamp } from '../domain/civil-date';
import { deriveFundingShortfall, deriveGoalProgress } from '../domain/savings-goal';
import { FinancialIntegrityError, toFinancialBigInt, toSafeFinancialNumber } from '../domain/integer-math';

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('GOAL_ERR_INVALID_CURRENCY');
  return currency;
}

async function loadGoalEntries(db: DatabaseConnection, goalId: string, includeDeleted = false) {
  return db.getAllAsync<SavingsGoalEntryRow>(
    `SELECT * FROM savings_goal_entries WHERE goal_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY occurred_at,created_at,id;`,
    goalId
  );
}

async function refreshLifecycle(db: DatabaseConnection, goalId: string, now: number): Promise<void> {
  const goal = await db.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=? AND deleted_at IS NULL;', goalId);
  if (!goal) throw new Error('GOAL_ERR_NOT_FOUND');
  const progress = deriveGoalProgress(await loadGoalEntries(db, goalId), goal.target_amount);
  if (progress.lifecycleStatus === 'completed' && goal.lifecycle_status !== 'completed') {
    await db.runAsync("UPDATE savings_goals SET lifecycle_status='completed',completed_at=?,updated_at=? WHERE id=?;", now, now, goalId);
  } else if (progress.lifecycleStatus === 'active' && goal.lifecycle_status !== 'active') {
    await db.runAsync("UPDATE savings_goals SET lifecycle_status='active',completed_at=NULL,updated_at=? WHERE id=?;", now, goalId);
  }
}

async function derivedAccountBalance(db: DatabaseConnection, accountId: string): Promise<{ balance: number; currency: string; archived: boolean }> {
  const account = await db.getFirstAsync<{ initial_balance: number; currency: string; archived_at: number | null }>(
    'SELECT initial_balance,currency,archived_at FROM accounts WHERE id=?;', accountId
  );
  if (!account) throw new Error('GOAL_ERR_ACCOUNT_NOT_FOUND');
  let balance = toFinancialBigInt(account.initial_balance, 'account opening balance');
  const rows = await db.getAllAsync<Pick<TransactionRow, 'id' | 'amount' | 'type' | 'transfer_role'>>(
    'SELECT id,amount,type,transfer_role FROM transactions WHERE account_id=? AND deleted_at IS NULL ORDER BY id;', accountId
  );
  for (const row of rows) {
    const amount = toFinancialBigInt(row.amount, `transaction ${row.id}`);
    if (row.type === 'income' || (row.type === 'transfer' && row.transfer_role === 'destination')) balance += amount;
    else if (row.type === 'expense' || (row.type === 'transfer' && row.transfer_role === 'source')) balance -= amount;
  }
  return { balance: toSafeFinancialNumber(balance, 'derived account balance'), currency: account.currency, archived: account.archived_at !== null };
}

async function totalAllocatedFromAccount(db: DatabaseConnection, accountId: string): Promise<number> {
  const rows = await db.getAllAsync<{ id: string; amount: number; entry_type: 'contribution' | 'withdrawal' }>(
    `SELECT e.id,e.amount,e.entry_type FROM savings_goal_entries e
     JOIN savings_goals g ON g.id=e.goal_id
     WHERE g.linked_account_id=? AND g.deleted_at IS NULL AND e.deleted_at IS NULL
     ORDER BY e.id;`, accountId
  );
  let total = 0n;
  for (const row of rows) {
    const amount = toFinancialBigInt(row.amount, `goal entry ${row.id}`);
    total += row.entry_type === 'contribution' ? amount : -amount;
  }
  if (total < 0n) throw new FinancialIntegrityError('Account goal allocations became negative.');
  return toSafeFinancialNumber(total, 'account goal allocations');
}

export async function getAccountAllocationState(accountId: string, customDb?: DatabaseConnection) {
  const db = customDb ?? (await getDatabase());
  const account = await derivedAccountBalance(db, accountId);
  const allocated = await totalAllocatedFromAccount(db, accountId);
  return { accountBalance: account.balance, totalAllocated: allocated, ...deriveFundingShortfall(account.balance, allocated) };
}

async function assertContributionAvailable(db: DatabaseConnection, accountId: string, amount: number): Promise<void> {
  const account = await derivedAccountBalance(db, accountId);
  const allocated = await totalAllocatedFromAccount(db, accountId);
  const state = deriveFundingShortfall(account.balance, allocated);
  if (toFinancialBigInt(amount, 'contribution') > toFinancialBigInt(state.availableToAllocate, 'available allocation')) {
    throw new Error('GOAL_ERR_ALLOCATION_EXCEEDS_AVAILABLE');
  }
}

async function insertEntry(
  db: DatabaseConnection,
  input: GoalEntryInput,
  linkMode: SavingsGoalLinkMode,
  transactionId: string | null
): Promise<SavingsGoalEntryRow> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('GOAL_ERR_INVALID_AMOUNT');
  const goal = await db.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=? AND deleted_at IS NULL;', input.goalId);
  if (!goal || !goal.linked_account_id) throw new Error('GOAL_ERR_LINKED_ACCOUNT_REQUIRED');
  if (goal.archived_at !== null) throw new Error('GOAL_ERR_ARCHIVED');
  const account = await derivedAccountBalance(db, goal.linked_account_id);
  if (account.currency !== goal.currency) throw new FinancialIntegrityError('Goal and account currencies disagree.');
  if (input.entryType === 'contribution') {
    if (account.archived) throw new Error('GOAL_ERR_ACCOUNT_ARCHIVED');
    await assertContributionAvailable(db, goal.linked_account_id, input.amountMinor);
  } else {
    const progress = deriveGoalProgress(await loadGoalEntries(db, goal.id), goal.target_amount);
    if (input.amountMinor > progress.current) throw new Error('GOAL_ERR_OVER_WITHDRAWAL');
  }
  const now = Date.now();
  const occurredAt = input.occurredAt ?? now;
  const occurredOn = input.occurredOn ?? localCivilDateFromTimestamp(occurredAt);
  assertCivilDate(occurredOn, 'occurredOn');
  const entry: SavingsGoalEntryRow = {
    id: makeId('goalentry'), goal_id: goal.id, entry_type: input.entryType, amount: input.amountMinor,
    link_mode: linkMode, transaction_id: transactionId, occurred_at: occurredAt, occurred_on: occurredOn,
    note: input.note?.trim() || null, cascade_deleted_at: null, created_at: now, updated_at: now, deleted_at: null,
  };
  await db.runAsync(
    `INSERT INTO savings_goal_entries (id,goal_id,entry_type,amount,link_mode,transaction_id,occurred_at,occurred_on,note,cascade_deleted_at,created_at,updated_at,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,NULL);`,
    entry.id,entry.goal_id,entry.entry_type,entry.amount,entry.link_mode,entry.transaction_id,
    entry.occurred_at,entry.occurred_on,entry.note,entry.created_at,entry.updated_at
  );
  await refreshLifecycle(db, goal.id, now);
  return entry;
}

export async function createSavingsGoal(
  input: CreateSavingsGoalInput,
  initialContributionMinor?: number,
  customDb?: DatabaseConnection
): Promise<SavingsGoalRow> {
  const db = customDb ?? (await getDatabase());
  const goalId = makeId('goal');
  await runExclusiveTransaction(db, async (txn) => {
    const name = input.name.trim();
    if (!name) throw new Error('GOAL_ERR_NAME_REQUIRED');
    if (!Number.isSafeInteger(input.targetAmountMinor) || input.targetAmountMinor <= 0) throw new Error('GOAL_ERR_INVALID_TARGET');
    const currency = normalizeCurrency(input.currency);
    if (input.targetDate) assertCivilDate(input.targetDate, 'targetDate');
    const linkedAccountId = input.linkedAccountId ?? null;
    if (linkedAccountId) {
      const account = await derivedAccountBalance(txn, linkedAccountId);
      if (account.archived) throw new Error('GOAL_ERR_ACCOUNT_ARCHIVED');
      if (account.currency !== currency) throw new Error('GOAL_ERR_CURRENCY_MISMATCH');
    }
    if (initialContributionMinor !== undefined && !linkedAccountId) throw new Error('GOAL_ERR_LINKED_ACCOUNT_REQUIRED');
    const now = Date.now();
    await txn.runAsync(
      `INSERT INTO savings_goals (id,name,preset_key,target_amount,currency,target_date,linked_account_id,lifecycle_status,completed_at,archived_at,note,created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,?,'active',NULL,NULL,?,?,?,NULL);`,
      goalId,name,input.presetKey ?? null,input.targetAmountMinor,currency,input.targetDate ?? null,
      linkedAccountId,input.note?.trim() || null,now,now
    );
    if (initialContributionMinor !== undefined) {
      await insertEntry(txn, { goalId, entryType: 'contribution', amountMinor: initialContributionMinor }, 'allocation_only', null);
    }
  });
  return (await getSavingsGoalById(goalId, db))!;
}

export async function getSavingsGoalById(goalId: string, customDb?: DatabaseConnection): Promise<SavingsGoalRow | null> {
  const db = customDb ?? (await getDatabase());
  return db.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=?;', goalId);
}

export async function getSavingsGoals(
  filter: { archived?: boolean; lifecycleStatus?: 'active' | 'completed' } = {},
  customDb?: DatabaseConnection
): Promise<SavingsGoalRow[]> {
  const db = customDb ?? (await getDatabase());
  const clauses = ['deleted_at IS NULL', filter.archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'];
  const params: unknown[] = [];
  if (filter.lifecycleStatus) { clauses.push('lifecycle_status=?'); params.push(filter.lifecycleStatus); }
  return db.getAllAsync<SavingsGoalRow>(`SELECT * FROM savings_goals WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC;`, ...params);
}

export async function getSavingsGoalProgress(goalId: string, customDb?: DatabaseConnection) {
  const db = customDb ?? (await getDatabase());
  const goal = await getSavingsGoalById(goalId, db);
  if (!goal || goal.deleted_at !== null) throw new Error('GOAL_ERR_NOT_FOUND');
  const progress = deriveGoalProgress(await loadGoalEntries(db, goalId), goal.target_amount);
  const funding = goal.linked_account_id ? await getAccountAllocationState(goal.linked_account_id, db) : null;
  return { goal, ...progress, funding };
}

export async function recordGoalAllocation(input: GoalEntryInput, customDb?: DatabaseConnection) {
  const db = customDb ?? (await getDatabase());
  let created!: SavingsGoalEntryRow;
  await runExclusiveTransaction(db, async (txn) => { created = await insertEntry(txn, input, 'allocation_only', null); });
  return created;
}

async function validateTransferEvidence(
  db: DatabaseConnection,
  goal: SavingsGoalRow,
  entryType: 'contribution' | 'withdrawal',
  transactionId: string,
  amount: number,
  requireDeleted: boolean = false
): Promise<TransactionRow> {
  const leg = await db.getFirstAsync<TransactionRow>('SELECT * FROM transactions WHERE id=?;', transactionId);
  if (!leg || leg.type !== 'transfer' || !leg.transfer_id || !goal.linked_account_id) throw new Error('GOAL_ERR_INVALID_TRANSFER');
  if ((leg.deleted_at !== null) !== requireDeleted) throw new Error('GOAL_ERR_INVALID_TRANSFER_STATE');
  const pair = await db.getAllAsync<TransactionRow>('SELECT * FROM transactions WHERE transfer_id=? ORDER BY transfer_role;', leg.transfer_id);
  if (pair.length !== 2 || pair.some((row) => row.amount !== leg.amount || row.timestamp !== leg.timestamp || row.occurred_on !== leg.occurred_on)) {
    throw new FinancialIntegrityError('Transfer evidence pair is partial or inconsistent.');
  }
  const roles = new Set(pair.map((row) => row.transfer_role));
  if (!roles.has('source') || !roles.has('destination')) throw new FinancialIntegrityError('Transfer evidence roles are invalid.');
  const expectedRole = entryType === 'contribution' ? 'destination' : 'source';
  if (leg.transfer_role !== expectedRole || leg.account_id !== goal.linked_account_id || leg.amount !== amount) {
    throw new Error('GOAL_ERR_TRANSFER_EVIDENCE_MISMATCH');
  }
  const accounts = await db.getAllAsync<{ id: string; currency: string }>(
    'SELECT id,currency FROM accounts WHERE id IN (?,?);', pair[0].account_id, pair[1].account_id
  );
  if (accounts.length !== 2 || accounts.some((account) => account.currency !== goal.currency)) throw new Error('GOAL_ERR_CURRENCY_MISMATCH');
  return leg;
}

export async function linkExistingTransferToGoal(
  input: GoalEntryInput & { transactionId: string },
  customDb?: DatabaseConnection
) {
  const db = customDb ?? (await getDatabase());
  let created!: SavingsGoalEntryRow;
  await runExclusiveTransaction(db, async (txn) => {
    const goal = await txn.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=? AND deleted_at IS NULL;', input.goalId);
    if (!goal) throw new Error('GOAL_ERR_NOT_FOUND');
    const leg = await validateTransferEvidence(txn, goal, input.entryType, input.transactionId, input.amountMinor);
    const reserved = await txn.getFirstAsync<{ id: string }>(
      `SELECT e.id FROM savings_goal_entries e
       JOIN transactions linked ON linked.id=e.transaction_id
       WHERE linked.transfer_id=? LIMIT 1;`,
      leg.transfer_id
    );
    if (reserved) throw new Error('GOAL_ERR_TRANSFER_EVIDENCE_RESERVED');
    created = await insertEntry(txn, { ...input, occurredAt: leg.timestamp, occurredOn: leg.occurred_on }, 'existing_transfer', leg.id);
  });
  return created;
}

export async function recordOwnedGoalTransfer(
  input: GoalEntryInput & { otherAccountId: string },
  customDb?: DatabaseConnection
) {
  const db = customDb ?? (await getDatabase());
  let created!: SavingsGoalEntryRow;
  await runExclusiveTransaction(db, async (txn) => {
    const goal = await txn.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=? AND deleted_at IS NULL;', input.goalId);
    if (!goal?.linked_account_id) throw new Error('GOAL_ERR_LINKED_ACCOUNT_REQUIRED');
    const transfer = await createTransferInTransaction({
      sourceAccountId: input.entryType === 'contribution' ? input.otherAccountId : goal.linked_account_id,
      destinationAccountId: input.entryType === 'contribution' ? goal.linked_account_id : input.otherAccountId,
      amountMinor: input.amountMinor, occurredAt: input.occurredAt, occurredOn: input.occurredOn, note: input.note,
    }, txn);
    const leg = input.entryType === 'contribution' ? transfer.destinationTransaction : transfer.sourceTransaction;
    created = await insertEntry(txn, { ...input, occurredAt: leg.timestamp, occurredOn: leg.occurred_on }, 'owned_transfer', leg.id);
  });
  return created;
}

export async function softDeleteGoalEntry(entryId: string, customDb?: DatabaseConnection): Promise<void> {
  const db = customDb ?? (await getDatabase());
  await runExclusiveTransaction(db, async (txn) => {
    const entry = await txn.getFirstAsync<SavingsGoalEntryRow>('SELECT * FROM savings_goal_entries WHERE id=? AND deleted_at IS NULL;', entryId);
    if (!entry) throw new Error('GOAL_ERR_ENTRY_NOT_FOUND');
    const now = Date.now();
    if (entry.link_mode === 'owned_transfer' && entry.transaction_id) {
      const leg = await txn.getFirstAsync<TransactionRow>('SELECT * FROM transactions WHERE id=?;', entry.transaction_id);
      if (!leg?.transfer_id) throw new FinancialIntegrityError('Owned transfer evidence is missing.');
      await validateTransferEvidence(txn, (await getSavingsGoalById(entry.goal_id, txn))!, entry.entry_type, leg.id, entry.amount);
      await txn.runAsync('UPDATE transactions SET deleted_at=?,updated_at=? WHERE transfer_id=? AND deleted_at IS NULL;', now,now,leg.transfer_id);
      await txn.runAsync('UPDATE savings_goal_entries SET deleted_at=?,cascade_deleted_at=?,updated_at=? WHERE id=?;', now,now,now,entry.id);
    } else {
      await txn.runAsync('UPDATE savings_goal_entries SET deleted_at=?,cascade_deleted_at=NULL,updated_at=? WHERE id=?;', now,now,entry.id);
    }
    await refreshLifecycle(txn, entry.goal_id, now);
  });
}

export async function restoreGoalEntry(entryId: string, customDb?: DatabaseConnection): Promise<void> {
  const db = customDb ?? (await getDatabase());
  await runExclusiveTransaction(db, async (txn) => {
    const entry = await txn.getFirstAsync<SavingsGoalEntryRow>('SELECT * FROM savings_goal_entries WHERE id=? AND deleted_at IS NOT NULL;', entryId);
    if (!entry) throw new Error('GOAL_ERR_ENTRY_NOT_FOUND');
    const goal = await txn.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=? AND deleted_at IS NULL;', entry.goal_id);
    if (!goal?.linked_account_id || goal.archived_at !== null) throw new Error('GOAL_ERR_UNAVAILABLE');
    if (entry.link_mode === 'owned_transfer' && entry.transaction_id) {
      const leg = await validateTransferEvidence(txn, goal, entry.entry_type, entry.transaction_id, entry.amount, true);
      await txn.runAsync('UPDATE transactions SET deleted_at=NULL,updated_at=? WHERE transfer_id=?;', Date.now(),leg.transfer_id);
    } else if (entry.link_mode === 'existing_transfer' && entry.transaction_id) {
      await validateTransferEvidence(txn, goal, entry.entry_type, entry.transaction_id, entry.amount);
    }
    if (entry.entry_type === 'contribution') await assertContributionAvailable(txn, goal.linked_account_id, entry.amount);
    else {
      const current = deriveGoalProgress(await loadGoalEntries(txn, goal.id), goal.target_amount).current;
      if (entry.amount > current) throw new Error('GOAL_ERR_OVER_WITHDRAWAL');
    }
    const now = Date.now();
    await txn.runAsync('UPDATE savings_goal_entries SET deleted_at=NULL,cascade_deleted_at=NULL,updated_at=? WHERE id=?;', now,entry.id);
    await refreshLifecycle(txn, goal.id, now);
  });
}

export async function updateSavingsGoalTarget(goalId: string, targetAmountMinor: number, customDb?: DatabaseConnection): Promise<void> {
  if (!Number.isSafeInteger(targetAmountMinor) || targetAmountMinor <= 0) throw new Error('GOAL_ERR_INVALID_TARGET');
  const db = customDb ?? (await getDatabase());
  await runExclusiveTransaction(db, async (txn) => {
    const now = Date.now();
    await txn.runAsync('UPDATE savings_goals SET target_amount=?,updated_at=? WHERE id=? AND deleted_at IS NULL;', targetAmountMinor,now,goalId);
    await refreshLifecycle(txn, goalId, now);
  });
}

export async function updateSavingsGoal(goalId:string,input:UpdateSavingsGoalInput,customDb?:DatabaseConnection):Promise<SavingsGoalRow>{
  const db=customDb??(await getDatabase());
  await runExclusiveTransaction(db,async(txn)=>{
    const goal=await txn.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=? AND deleted_at IS NULL;',goalId);if(!goal)throw new Error('GOAL_ERR_NOT_FOUND');
    const name=input.name===undefined?goal.name:input.name.trim();if(!name)throw new Error('GOAL_ERR_NAME_REQUIRED');
    const target=input.targetAmountMinor??goal.target_amount;if(!Number.isSafeInteger(target)||target<=0)throw new Error('GOAL_ERR_INVALID_TARGET');
    const currency=input.currency===undefined?goal.currency:normalizeCurrency(input.currency);
    const linkedAccount=input.linkedAccountId===undefined?goal.linked_account_id:input.linkedAccountId;
    const targetDate=input.targetDate===undefined?goal.target_date:input.targetDate;if(targetDate)assertCivilDate(targetDate,'targetDate');
    if(currency!==goal.currency||linkedAccount!==goal.linked_account_id){const history=await txn.getFirstAsync<{c:number}>('SELECT count(*) c FROM savings_goal_entries WHERE goal_id=?;',goalId);if((history?.c??0)>0)throw new Error('GOAL_ERR_HISTORY_LOCKS_ACCOUNT_AND_CURRENCY');}
    if(linkedAccount){const account=await derivedAccountBalance(txn,linkedAccount);if(account.archived)throw new Error('GOAL_ERR_ACCOUNT_ARCHIVED');if(account.currency!==currency)throw new Error('GOAL_ERR_CURRENCY_MISMATCH');}
    const now=Date.now();await txn.runAsync('UPDATE savings_goals SET name=?,preset_key=?,target_amount=?,currency=?,target_date=?,linked_account_id=?,note=?,updated_at=? WHERE id=?;',name,input.presetKey===undefined?goal.preset_key:input.presetKey,target,currency,targetDate,linkedAccount,input.note===undefined?goal.note:(input.note?.trim()||null),now,goalId);await refreshLifecycle(txn,goalId,now);
  });
  return (await getSavingsGoalById(goalId,db))!;
}

export async function archiveSavingsGoal(goalId: string, mode: 'keep_allocated' | 'unallocate', customDb?: DatabaseConnection): Promise<void> {
  const db = customDb ?? (await getDatabase());
  await runExclusiveTransaction(db, async (txn) => {
    const goal = await txn.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=? AND deleted_at IS NULL;', goalId);
    if (!goal) throw new Error('GOAL_ERR_NOT_FOUND');
    const progress = deriveGoalProgress(await loadGoalEntries(txn, goalId), goal.target_amount);
    if (mode === 'unallocate' && progress.current > 0) {
      await insertEntry(txn, { goalId,entryType:'withdrawal',amountMinor:progress.current }, 'allocation_only', null);
    }
    const now = Date.now();
    await txn.runAsync('UPDATE savings_goals SET archived_at=?,updated_at=? WHERE id=?;', now,now,goalId);
  });
}

export async function restoreArchivedSavingsGoal(goalId: string, customDb?: DatabaseConnection): Promise<void> {
  const db = customDb ?? (await getDatabase());
  await runExclusiveTransaction(db,async(txn)=>{const goal=await txn.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=? AND deleted_at IS NULL;',goalId);if(!goal)throw new Error('GOAL_ERR_NOT_FOUND');if(goal.linked_account_id){const account=await derivedAccountBalance(txn,goal.linked_account_id);if(account.archived)throw new Error('GOAL_ERR_ACCOUNT_ARCHIVED');}await txn.runAsync('UPDATE savings_goals SET archived_at=NULL,updated_at=? WHERE id=?;',Date.now(),goalId);});
}

export async function softDeleteSavingsGoal(goalId: string, customDb?: DatabaseConnection): Promise<void> {
  const db = customDb ?? (await getDatabase());
  await runExclusiveTransaction(db, async (txn) => {
    const goal = await txn.getFirstAsync<SavingsGoalRow>('SELECT * FROM savings_goals WHERE id=? AND deleted_at IS NULL;', goalId);
    if (!goal) throw new Error('GOAL_ERR_NOT_FOUND');
    const progress = deriveGoalProgress(await loadGoalEntries(txn, goalId), goal.target_amount);
    if (progress.current !== 0) throw new Error('GOAL_ERR_FUNDED_GOAL_CANNOT_DELETE');
    const now = Date.now();
    await txn.runAsync('UPDATE savings_goals SET deleted_at=?,updated_at=? WHERE id=?;', now,now,goalId);
  });
}
