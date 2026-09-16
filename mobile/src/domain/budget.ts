import { FinancialIntegrityError, progressBasisPoints, toFinancialBigInt, toSafeFinancialNumber } from './integer-math';

export interface BudgetAmounts {
  planned: number;
  rollover: number;
  actual: number;
}

export function calculateBudgetAmounts(input: BudgetAmounts) {
  const planned = toFinancialBigInt(input.planned, 'planned');
  const rollover = toFinancialBigInt(input.rollover, 'rollover');
  const actual = toFinancialBigInt(input.actual, 'actual');
  if (planned < 0n || rollover < 0n || actual < 0n) {
    throw new FinancialIntegrityError('Budget amounts cannot be negative.');
  }
  const effective = planned + rollover;
  const remaining = effective - actual;
  const effectiveNumber = toSafeFinancialNumber(effective, 'effective budget limit');
  return {
    effectiveLimit: effectiveNumber,
    remaining: toSafeFinancialNumber(remaining, 'budget remaining'),
    overspent: toSafeFinancialNumber(remaining < 0n ? -remaining : 0n, 'budget overspent'),
    progressBp: effective === 0n ? 0 : progressBasisPoints(input.actual, effectiveNumber),
  };
}

export function calculateUnspentRollover(effectiveLimit: number, actual: number): number {
  const remaining = toFinancialBigInt(effectiveLimit, 'previous effective limit') - toFinancialBigInt(actual, 'previous actual');
  return toSafeFinancialNumber(remaining > 0n ? remaining : 0n, 'rollover');
}

export function calculateUnallocated(expenseLimit: number, categoryAllocations: readonly number[]): number {
  const allocated = categoryAllocations.reduce(
    (sum, amount, index) => sum + toFinancialBigInt(amount, `category allocation ${index}`),
    0n
  );
  const result = toFinancialBigInt(expenseLimit, 'expense limit') - allocated;
  if (result < 0n) throw new FinancialIntegrityError('Category allocations exceed the expense limit.');
  return toSafeFinancialNumber(result, 'unallocated budget');
}
