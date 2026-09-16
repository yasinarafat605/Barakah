import { calculateBudgetAmounts, calculateUnallocated, calculateUnspentRollover } from '../budget';
import { deriveFundingShortfall, deriveGoalProgress, requiredContributionPerPeriod } from '../savings-goal';
import { FinancialIntegrityError, progressBasisPoints } from '../integer-math';

describe('BigInt-safe planning calculations',()=>{
  it('calculates rollover, reconciliation and basis points without floating-point money arithmetic',()=>{
    expect(calculateUnspentRollover(1000,650)).toBe(350);
    expect(calculateUnallocated(1000,[200,300])).toBe(500);
    expect(calculateBudgetAmounts({planned:1000,rollover:350,actual:1400})).toMatchObject({effectiveLimit:1350,remaining:-50,overspent:50});
    expect(progressBasisPoints(1,3)).toBe(3333);
  });
  it('fails closed when a derived value exceeds the safe integer boundary',()=>{
    expect(()=>calculateBudgetAmounts({planned:Number.MAX_SAFE_INTEGER,rollover:1,actual:0})).toThrow(FinancialIntegrityError);
  });
  it('derives goal completion, surplus and account underfunding',()=>{
    expect(deriveGoalProgress([{entry_type:'contribution',amount:120}],100)).toMatchObject({current:120,remaining:0,surplus:20,lifecycleStatus:'completed'});
    expect(deriveFundingShortfall(50,120)).toEqual({availableToAllocate:-70,fundingShortfall:70,underfunded:true});
    expect(requiredContributionPerPeriod(10,100,6)).toBe(15);
  });
});
