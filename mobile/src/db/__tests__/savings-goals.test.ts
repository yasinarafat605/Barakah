import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { createAccount, archiveAccount } from '../accounts';
import { createExpenseTransaction, createTransfer, softDeleteTransaction, restoreTransaction } from '../transactions';
import { createSavingsGoal, getAccountAllocationState, getSavingsGoalEntries, getSavingsGoalProgress, linkExistingTransferToGoal, recordGoalAllocation, recordOwnedGoalTransfer, restoreGoalEntry, softDeleteGoalEntry, updateSavingsGoal } from '../savings-goals';
import type { DatabaseConnection } from '../types';

describe('Savings-goal allocation ledger',()=>{
  let db:DatabaseConnection;
  beforeEach(async()=>{db=createBetterSqliteConnection();await runMigrations(db);});
  afterEach(async()=>db.closeAsync());

  async function fixture(){
    const source=await createAccount({name:'Source',type:'bank',initialBalancePoisha:1000,currency:'BDT'},db);
    const goalAccount=await createAccount({name:'Goal cash',type:'cash',initialBalancePoisha:0,currency:'BDT'},db);
    const goal=await createSavingsGoal({name:'Emergency',targetAmountMinor:500,currency:'BDT',linkedAccountId:goalAccount.id},undefined,db);
    const transfer=await createTransfer({sourceAccountId:source.id,destinationAccountId:goalAccount.id,amountMinor:200,occurredOn:'2026-01-01'},db);
    expect(transfer.sourceTransaction.occurred_on).toBe('2026-01-01');
    expect(transfer.destinationTransaction.occurred_on).toBe('2026-01-01');
    return {source,goalAccount,goal,transfer};
  }

  it('rejects active and historical duplicate transfer links and restores the original entry',async()=>{
    const {goal,transfer,source}=await fixture();
    const entry=await linkExistingTransferToGoal({goalId:goal.id,entryType:'contribution',amountMinor:200,transactionId:transfer.destinationTransaction.id},db);
    await expect(linkExistingTransferToGoal({goalId:goal.id,entryType:'contribution',amountMinor:200,transactionId:transfer.destinationTransaction.id},db)).rejects.toThrow(/RESERVED|UNIQUE/);
    await softDeleteGoalEntry(entry.id,db);
    await expect(linkExistingTransferToGoal({goalId:goal.id,entryType:'contribution',amountMinor:200,transactionId:transfer.destinationTransaction.id},db)).rejects.toThrow(/RESERVED|UNIQUE/);
    await restoreGoalEntry(entry.id,db);
    expect((await getSavingsGoalProgress(goal.id,db)).current).toBe(200);
    const second=await createSavingsGoal({name:'Other',targetAmountMinor:500,currency:'BDT',linkedAccountId:source.id},undefined,db);
    await expect(linkExistingTransferToGoal({goalId:second.id,entryType:'withdrawal',amountMinor:200,transactionId:transfer.sourceTransaction.id},db)).rejects.toThrow(/RESERVED/);
  });

  it('cascades a confirmed existing-transfer deletion and restores both evidence and allocation',async()=>{
    const {goal,transfer}=await fixture();
    await linkExistingTransferToGoal({goalId:goal.id,entryType:'contribution',amountMinor:200,transactionId:transfer.destinationTransaction.id},db);
    await expect(softDeleteTransaction(transfer.destinationTransaction.id,db)).rejects.toThrow(/CONFIRMATION_REQUIRED/);
    await softDeleteTransaction(transfer.destinationTransaction.id,db,{confirmExistingGoalLink:true});
    expect((await getSavingsGoalProgress(goal.id,db)).current).toBe(0);
    await restoreTransaction(transfer.destinationTransaction.id,db);
    expect((await getSavingsGoalProgress(goal.id,db)).current).toBe(200);
  });

  it('enforces account-wide availability, reports underfunding, and gates account archival',async()=>{
    const account=await createAccount({name:'Cash',type:'cash',initialBalancePoisha:300,currency:'BDT'},db);
    const one=await createSavingsGoal({name:'One',targetAmountMinor:500,currency:'BDT',linkedAccountId:account.id},undefined,db);
    const two=await createSavingsGoal({name:'Two',targetAmountMinor:500,currency:'BDT',linkedAccountId:account.id},undefined,db);
    await recordGoalAllocation({goalId:one.id,entryType:'contribution',amountMinor:200},db);
    await expect(recordGoalAllocation({goalId:two.id,entryType:'contribution',amountMinor:101},db)).rejects.toThrow(/EXCEEDS_AVAILABLE/);
    expect(await getAccountAllocationState(account.id,db)).toMatchObject({totalAllocated:200,availableToAllocate:100,underfunded:false});
    await createExpenseTransaction({accountId:account.id,categoryId:'cat_exp_food_groceries',amountMinor:250,occurredOn:'2026-01-02'},db);
    expect(await getAccountAllocationState(account.id,db)).toMatchObject({totalAllocated:200,availableToAllocate:-150,fundingShortfall:150,underfunded:true});
    await expect(archiveAccount(account.id,false,db)).rejects.toThrow(/CONFIRMATION/);
    await archiveAccount(account.id,true,db);
    await expect(createExpenseTransaction({accountId:account.id,categoryId:'cat_exp_food_groceries',amountMinor:1},db)).rejects.toThrow(/ARCHIVED/);
  });

  it('creates initial allocation atomically and derives completion/reopening from target changes',async()=>{
    const account=await createAccount({name:'Cash',type:'cash',initialBalancePoisha:500,currency:'BDT'},db);
    await expect(createSavingsGoal({name:'Too much',targetAmountMinor:100,currency:'BDT',linkedAccountId:account.id},501,db)).rejects.toThrow(/EXCEEDS_AVAILABLE/);
    expect((await db.getFirstAsync<{c:number}>("SELECT count(*) c FROM savings_goals WHERE name='Too much';"))?.c).toBe(0);
    const goal=await createSavingsGoal({name:'Target',targetAmountMinor:100,currency:'BDT',linkedAccountId:account.id},100,db);
    expect((await getSavingsGoalProgress(goal.id,db)).lifecycleStatus).toBe('completed');
    await updateSavingsGoal(goal.id,{targetAmountMinor:200},db);
    expect((await getSavingsGoalProgress(goal.id,db)).lifecycleStatus).toBe('active');
    await expect(updateSavingsGoal(goal.id,{currency:'USD'},db)).rejects.toThrow(/HISTORY_LOCKS/);
  });

  it('creates a target-only goal and blocks entries until an account is linked',async()=>{
    const goal=await createSavingsGoal({name:'Target only',targetAmountMinor:500,currency:'GBP'},undefined,db);
    expect(goal.linked_account_id).toBeNull();
    await expect(recordGoalAllocation({goalId:goal.id,entryType:'contribution',amountMinor:1},db)).rejects.toThrow(/LINKED_ACCOUNT_REQUIRED/);
  });

  it('completes all three entry service modes and restores owned-transfer history atomically',async()=>{
    const source=await createAccount({name:'Source',type:'bank',initialBalancePoisha:1000,currency:'BDT'},db);
    const linked=await createAccount({name:'Linked',type:'bank',initialBalancePoisha:500,currency:'BDT'},db);
    const goal=await createSavingsGoal({name:'Modes',targetAmountMinor:1000,currency:'BDT',linkedAccountId:linked.id},undefined,db);
    await recordGoalAllocation({goalId:goal.id,entryType:'contribution',amountMinor:100,occurredOn:'2026-02-01'},db);
    const existingTransfer=await createTransfer({sourceAccountId:source.id,destinationAccountId:linked.id,amountMinor:100,occurredOn:'2026-02-02'},db);
    await linkExistingTransferToGoal({goalId:goal.id,entryType:'contribution',amountMinor:100,transactionId:existingTransfer.destinationTransaction.id},db);
    const owned=await recordOwnedGoalTransfer({goalId:goal.id,entryType:'contribution',amountMinor:100,otherAccountId:source.id,occurredOn:'2026-02-03'},db);
    expect((await getSavingsGoalEntries(goal.id,false,db)).map((entry)=>entry.link_mode)).toEqual(['allocation_only','existing_transfer','owned_transfer']);
    await softDeleteGoalEntry(owned.id,db);
    expect((await getSavingsGoalEntries(goal.id,true,db)).find((entry)=>entry.id===owned.id)?.deleted_at).not.toBeNull();
    await restoreGoalEntry(owned.id,db);
    expect((await getSavingsGoalEntries(goal.id,false,db)).some((entry)=>entry.id===owned.id)).toBe(true);
  });
});
