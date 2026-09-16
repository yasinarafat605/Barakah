import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { createAccount } from '../accounts';
import { createExpenseTransaction, softDeleteTransaction, restoreTransaction } from '../transactions';
import { createCounterparty } from '../counterparties';
import { createDebt, recordRepayment } from '../debts';
import { createBudget, getBudgetCategories, getBudgetPerformance, restoreBudgetCategory, softDeleteBudgetCategory, updateBudget } from '../budgets';
import type { DatabaseConnection } from '../types';

describe('Budget repository and reconciled debt actuals', () => {
  let db: DatabaseConnection;
  beforeEach(async () => { db=createBetterSqliteConnection(); await runMigrations(db); });
  afterEach(async () => db.closeAsync());

  async function fixture() {
    const account = await createAccount({ name:'Cash',type:'cash',initialBalancePoisha:1_000_000,currency:'BDT' },db);
    const person = await createCounterparty({ name:'Person' },db);
    await createExpenseTransaction({ accountId:account.id,categoryId:'cat_exp_food_groceries',amountMinor:100,occurredOn:'2026-01-10' },db);
    await createDebt({ counterpartyId:person.id,direction:'lent',originalPrincipalMinor:200,currency:'BDT',openingMode:'new_with_cash',accountId:account.id,openedOn:'2026-01-11' },db);
    const borrowed = await createDebt({ counterpartyId:person.id,direction:'borrowed',originalPrincipalMinor:300,currency:'BDT',openingMode:'existing_balance',openedOn:'2026-01-01' },db);
    const repayment = await recordRepayment({ debtId:borrowed.id,accountId:account.id,amountMinor:50,occurredOn:'2026-01-12' },db);
    expect((await db.getFirstAsync<{occurred_on:string}>('SELECT occurred_on FROM transactions WHERE id=?;',repayment.transaction_id!))?.occurred_on).toBe('2026-01-12');
    return { account, repayment };
  }

  async function performance(categories: {categoryId:string;amountMinor:number}[]) {
    const { account, repayment } = await fixture();
    const budget = await createBudget({ periodType:'monthly',startsOn:'2026-01-01',endsOn:'2026-01-31',currency:'BDT',accountId:account.id,expenseLimitMinor:1000,categories },db);
    return { result:await getBudgetPerformance(budget.id,db), repayment };
  }

  it.each([
    ['no debt allocations',[],100],
    ['Loan Given allocation',[{categoryId:'cat_exp_loan_given',amountMinor:300}],300],
    ['Loan Repayment allocation',[{categoryId:'cat_exp_loan_repayment',amountMinor:300}],150],
    ['both debt expense categories',[{categoryId:'cat_exp_loan_given',amountMinor:300},{categoryId:'cat_exp_loan_repayment',amountMinor:300}],350],
  ] as const)('%s',async (_label,categories,expected) => {
    const { result }=await performance([...categories]);
    expect(result.overallActual).toBe(expected);
    expect(result.actualOutsideAllocatedCategories + result.categories.reduce((sum,item)=>sum+item.actual,0)).toBe(result.overallActual);
    expect(result.incomeActual).toBe(0);
  });

  it('reconciles ordinary and debt actuals and reflects soft-delete/restore',async () => {
    const { result,repayment }=await performance([{categoryId:'cat_exp_loan_repayment',amountMinor:300}]);
    expect(result.overallActual).toBe(150);
    await softDeleteTransaction(repayment.transaction_id!,db);
    expect((await getBudgetPerformance(result.budget.id,db)).overallActual).toBe(100);
    await restoreTransaction(repayment.transaction_id!,db);
    expect((await getBudgetPerformance(result.budget.id,db)).overallActual).toBe(150);
  });

  it('fails closed when debt metadata and stable category disagree',async () => {
    const { result,repayment }=await performance([{categoryId:'cat_exp_loan_repayment',amountMinor:300}]);
    await db.runAsync("UPDATE transactions SET category_id='cat_exp_food_groceries' WHERE id=?;",repayment.transaction_id!);
    await expect(getBudgetPerformance(result.budget.id,db)).rejects.toThrow(/metadata disagrees/i);
  });

  it('enforces the global/account overlap matrix and derives unspent-only rollover',async()=>{
    const one=await createAccount({name:'One',type:'cash',initialBalancePoisha:1000,currency:'BDT'},db);
    const two=await createAccount({name:'Two',type:'cash',initialBalancePoisha:1000,currency:'BDT'},db);
    const first=await createBudget({periodType:'monthly',startsOn:'2026-01-01',endsOn:'2026-01-31',currency:'BDT',accountId:one.id,expenseLimitMinor:500},db);
    await createBudget({periodType:'monthly',startsOn:'2026-01-01',endsOn:'2026-01-31',currency:'BDT',accountId:two.id,expenseLimitMinor:500},db);
    await expect(createBudget({periodType:'monthly',startsOn:'2026-01-10',endsOn:'2026-01-20',currency:'BDT',expenseLimitMinor:500},db)).rejects.toThrow(/OVERLAPPING_SCOPE/);
    await createExpenseTransaction({accountId:one.id,categoryId:'cat_exp_food_groceries',amountMinor:100,occurredOn:'2026-01-10'},db);
    const next=await createBudget({periodType:'monthly',startsOn:'2026-02-01',endsOn:'2026-02-28',currency:'BDT',accountId:one.id,expenseLimitMinor:500,rolloverPolicy:'unspent_only',rolloverFromBudgetId:first.id},db);
    expect(await getBudgetPerformance(next.id,db)).toMatchObject({rollover:400,effectiveExpenseLimit:900,remaining:900});
    await createExpenseTransaction({accountId:one.id,categoryId:'cat_exp_food_groceries',amountMinor:100,occurredOn:'2026-02-10'},db);
    const third=await createBudget({periodType:'monthly',startsOn:'2026-03-01',endsOn:'2026-03-31',currency:'BDT',accountId:one.id,expenseLimitMinor:500,rolloverPolicy:'unspent_only',rolloverFromBudgetId:next.id},db);
    expect(await getBudgetPerformance(third.id,db)).toMatchObject({rollover:800,effectiveExpenseLimit:1300,remaining:1300});
  });

  it('updates allocations atomically and revalidates limit when restoring one',async()=>{
    const account=await createAccount({name:'Cash',type:'cash',initialBalancePoisha:1000,currency:'BDT'},db);
    const budget=await createBudget({periodType:'monthly',startsOn:'2026-03-01',endsOn:'2026-03-31',currency:'BDT',accountId:account.id,expenseLimitMinor:500,categories:[{categoryId:'cat_exp_food_groceries',amountMinor:300}]},db);
    const [allocation]=await getBudgetCategories(budget.id,db);await softDeleteBudgetCategory(allocation.id,db);
    await updateBudget(budget.id,{periodType:'monthly',startsOn:'2026-03-01',endsOn:'2026-03-31',currency:'BDT',accountId:account.id,expenseLimitMinor:200,categories:[]},db);
    await expect(restoreBudgetCategory(allocation.id,db)).rejects.toThrow(/exceed/i);
    await updateBudget(budget.id,{periodType:'monthly',startsOn:'2026-03-01',endsOn:'2026-03-31',currency:'BDT',accountId:account.id,expenseLimitMinor:500,categories:[{categoryId:'cat_exp_food_groceries',amountMinor:250}]},db);
    expect(await getBudgetCategories(budget.id,db)).toHaveLength(1);
  });
});
