import { ceilDivideFinancial, progressBasisPoints, toFinancialBigInt, toSafeFinancialNumber } from './integer-math';

export interface SignedGoalEntry {
  amount: number;
  entry_type: 'contribution' | 'withdrawal';
}

export function deriveGoalProgress(entries: readonly SignedGoalEntry[], targetAmount: number) {
  let contributed = 0n;
  let withdrawn = 0n;
  for (const [index, entry] of entries.entries()) {
    const amount = toFinancialBigInt(entry.amount, `goal entry ${index}`);
    if (amount <= 0n) throw new Error('Goal entry amounts must be positive.');
    if (entry.entry_type === 'contribution') contributed += amount;
    else withdrawn += amount;
  }
  const current = contributed - withdrawn;
  if (current < 0n) throw new Error('GOAL_ERR_NEGATIVE_ALLOCATION');
  const target = toFinancialBigInt(targetAmount, 'goal target');
  if (target <= 0n) throw new Error('Goal target must be positive.');
  const remaining = target > current ? target - current : 0n;
  const surplus = current > target ? current - target : 0n;
  const currentNumber = toSafeFinancialNumber(current, 'goal allocation');
  return {
    contributed: toSafeFinancialNumber(contributed, 'goal contributions'),
    withdrawn: toSafeFinancialNumber(withdrawn, 'goal withdrawals'),
    current: currentNumber,
    remaining: toSafeFinancialNumber(remaining, 'goal remaining'),
    surplus: toSafeFinancialNumber(surplus, 'goal surplus'),
    progressBp: progressBasisPoints(currentNumber, targetAmount),
    lifecycleStatus: current >= target ? 'completed' as const : 'active' as const,
  };
}

export function deriveFundingShortfall(accountBalance: number, allocated: number) {
  const balance = toFinancialBigInt(accountBalance, 'account balance');
  const total = toFinancialBigInt(allocated, 'account allocations');
  const available = balance - total;
  const shortfall = total > balance ? total - balance : 0n;
  return {
    availableToAllocate: toSafeFinancialNumber(available, 'available allocation'),
    fundingShortfall: toSafeFinancialNumber(shortfall, 'funding shortfall'),
    underfunded: shortfall > 0n,
  };
}

export function requiredContributionPerPeriod(current: number, target: number, periodsRemaining: number): number {
  const currentBig = toFinancialBigInt(current, 'goal current');
  const targetBig = toFinancialBigInt(target, 'goal target');
  if (currentBig < 0n || targetBig <= 0n || !Number.isSafeInteger(periodsRemaining) || periodsRemaining <= 0) {
    throw new Error('GOAL_ERR_INVALID_REQUIRED_PERIOD_INPUT');
  }
  const remaining = targetBig > currentBig ? targetBig - currentBig : 0n;
  return ceilDivideFinancial(toSafeFinancialNumber(remaining, 'goal remaining'), periodsRemaining);
}
