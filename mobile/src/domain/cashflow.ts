/**
 * Cash-Flow vs. Earned Income Classification Domain Module
 * Strict adherence to:
 * - Requirement 4: Loan Received is not earned income. Loan Given is not consumption spending.
 *   Principal Repayment is not ordinary consumption spending. Loan Repayment Received is not earned income.
 * - Accurate separation of total cash flow from economic income/expense.
 */

export const DEBT_PRINCIPAL_CATEGORY_KEYS = new Set<string>([
  'loan_received',
  'loan_repayment_received',
  'loan_repayment',
  'loan_given',
  // Stable Category IDs:
  'cat_inc_loan_received',
  'cat_inc_loan_repayment_received',
  'cat_exp_loan_repayment',
  'cat_exp_loan_given',
]);

/**
 * Returns true if the category represents a debt principal movement
 * rather than earned income or ordinary consumption spending.
 */
export function isDebtPrincipalCategory(categoryKeyOrId: string | null | undefined): boolean {
  if (!categoryKeyOrId) return false;
  // Strip 'categories.' prefix if present
  const key = categoryKeyOrId.replace(/^categories\./, '');
  return DEBT_PRINCIPAL_CATEGORY_KEYS.has(key);
}

export interface CashFlowTransaction {
  amount: number; // Positive integer minor units
  type: 'income' | 'expense' | 'transfer';
  category_id?: string | null;
  category_name_key?: string | null;
  transfer_role?: 'source' | 'destination' | null;
}

export interface CashFlowSummary {
  /** Gross cash inflow into accounts (includes debt receipts) */
  totalCashInflow: number;
  /** True economic earned income (salary, business, gifts, etc. - excludes debt principal) */
  earnedIncome: number;
  /** Gross cash outflow from accounts (includes debt disbursements & repayments) */
  totalCashOutflow: number;
  /** True ordinary living/consumption expenses (groceries, bills, etc. - excludes debt principal) */
  ordinaryExpenses: number;
  /** Total debt principal received (borrowed or lent repayments received) */
  debtPrincipalInflow: number;
  /** Total debt principal paid out (lent or borrowed repayments made) */
  debtPrincipalOutflow: number;
}

/**
 * Aggregates transactions into gross cash flow versus true economic income & spending.
 */
export function classifyCashFlow(transactions: CashFlowTransaction[]): CashFlowSummary {
  let totalCashInflow = 0;
  let earnedIncome = 0;
  let totalCashOutflow = 0;
  let ordinaryExpenses = 0;
  let debtPrincipalInflow = 0;
  let debtPrincipalOutflow = 0;

  for (const tx of transactions) {
    const isDebt =
      isDebtPrincipalCategory(tx.category_id) || isDebtPrincipalCategory(tx.category_name_key);

    if (tx.type === 'income') {
      totalCashInflow += tx.amount;
      if (isDebt) {
        debtPrincipalInflow += tx.amount;
      } else {
        earnedIncome += tx.amount;
      }
    } else if (tx.type === 'expense') {
      totalCashOutflow += tx.amount;
      if (isDebt) {
        debtPrincipalOutflow += tx.amount;
      } else {
        ordinaryExpenses += tx.amount;
      }
    } else if (tx.type === 'transfer') {
      // Transfers shift money between accounts without altering net worth or income/expense
      if (tx.transfer_role === 'destination') {
        totalCashInflow += tx.amount;
      } else if (tx.transfer_role === 'source') {
        totalCashOutflow += tx.amount;
      }
    }
  }

  return {
    totalCashInflow,
    earnedIncome,
    totalCashOutflow,
    ordinaryExpenses,
    debtPrincipalInflow,
    debtPrincipalOutflow,
  };
}
