import { classifyCashFlow, isDebtPrincipalCategory } from '../cashflow';

describe('Cash flow and income/expense excluding debt principal', () => {
  it('identifies debt principal categories accurately', () => {
    expect(isDebtPrincipalCategory('loan_received')).toBe(true);
    expect(isDebtPrincipalCategory('categories.loan_received')).toBe(true);
    expect(isDebtPrincipalCategory('loan_repayment_received')).toBe(true);
    expect(isDebtPrincipalCategory('loan_repayment')).toBe(true);
    expect(isDebtPrincipalCategory('loan_given')).toBe(true);

    // Stable category IDs
    expect(isDebtPrincipalCategory('cat_inc_loan_received')).toBe(true);
    expect(isDebtPrincipalCategory('cat_inc_loan_repayment_received')).toBe(true);
    expect(isDebtPrincipalCategory('cat_exp_loan_repayment')).toBe(true);
    expect(isDebtPrincipalCategory('cat_exp_loan_given')).toBe(true);

    expect(isDebtPrincipalCategory('salary_wages')).toBe(false);
    expect(isDebtPrincipalCategory('cat_inc_salary_wages')).toBe(false);
    expect(isDebtPrincipalCategory('food_groceries')).toBe(false);
    expect(isDebtPrincipalCategory(null)).toBe(false);
  });

  it('separates gross cash flows from income and expense excluding debt principal', () => {
    const transactions = [
      // Earned income: Salary ৳50,000 (5000000 poisha)
      { amount: 5000000, type: 'income' as const, category_name_key: 'salary_wages' },
      // Debt cash receipt: Loan Received ৳20,000 (2000000 poisha)
      { amount: 2000000, type: 'income' as const, category_name_key: 'loan_received' },
      // Ordinary expense: Groceries ৳10,000 (1000000 poisha)
      { amount: 1000000, type: 'expense' as const, category_name_key: 'food_groceries' },
      // Debt repayment: Loan Repayment ৳5,000 (500000 poisha)
      { amount: 500000, type: 'expense' as const, category_name_key: 'loan_repayment' },
      // Debt disbursement given to a friend: Loan Given ৳3,000 (300000 poisha)
      { amount: 300000, type: 'expense' as const, category_name_key: 'loan_given' },
    ];

    const result = classifyCashFlow(transactions);

    // Total cash inflow = 50,000 + 20,000 = 70,000 (7000000 poisha)
    expect(result.grossExternalCashInflow).toBe(7000000);

    // Income excluding debt principal removes the 20,000 loan received.
    expect(result.incomeExcludingDebtPrincipal).toBe(5000000);
    expect(result.debtPrincipalInflow).toBe(2000000);

    // Total cash outflow = 10,000 + 5,000 + 3,000 = 18,000 (1800000 poisha)
    expect(result.grossExternalCashOutflow).toBe(1800000);

    // Expense excluding debt principal removes repayment and loan-given principal.
    expect(result.expenseExcludingDebtPrincipal).toBe(1000000);
    expect(result.debtPrincipalOutflow).toBe(800000);
  });

  it('keeps transfers out of external income and expense totals', () => {
    expect(classifyCashFlow([
      { amount: 250, type: 'transfer', transfer_role: 'source' },
      { amount: 250, type: 'transfer', transfer_role: 'destination' },
    ])).toEqual({
      grossExternalCashInflow: 0,
      incomeExcludingDebtPrincipal: 0,
      grossExternalCashOutflow: 0,
      expenseExcludingDebtPrincipal: 0,
      transferInflow: 250,
      transferOutflow: 250,
      debtPrincipalInflow: 0,
      debtPrincipalOutflow: 0,
    });
  });

  it('fails closed when an aggregate exceeds JavaScript safe-integer precision', () => {
    expect(() => classifyCashFlow([
      { amount: Number.MAX_SAFE_INTEGER, type: 'income', category_name_key: 'salary_wages' },
      { amount: 1, type: 'income', category_name_key: 'salary_wages' },
    ])).toThrow(/AGGREGATE_OVERFLOW/);
  });
});
