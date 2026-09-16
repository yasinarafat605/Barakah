/**
 * Cash-flow classification domain module.
 * Strict adherence to:
 * - Requirement 4: Loan Received is not earned income. Loan Given is not consumption spending.
 *   Principal Repayment is not ordinary consumption spending. Loan Repayment Received is not earned income.
 * - Accurate separation of gross external cash flow from income and expense excluding debt principal.
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
  grossExternalCashInflow: number;
  incomeExcludingDebtPrincipal: number;
  grossExternalCashOutflow: number;
  expenseExcludingDebtPrincipal: number;
  transferInflow: number;
  transferOutflow: number;
  /** Total debt principal received (borrowed or lent repayments received) */
  debtPrincipalInflow: number;
  /** Total debt principal paid out (lent or borrowed repayments made) */
  debtPrincipalOutflow: number;
}

/**
 * Aggregates transactions into gross external cash flow, debt principal, transfers,
 * and income/expense excluding debt principal.
 */
export function classifyCashFlow(transactions: CashFlowTransaction[]): CashFlowSummary {
  let grossExternalCashInflow = 0n;
  let incomeExcludingDebtPrincipal = 0n;
  let grossExternalCashOutflow = 0n;
  let expenseExcludingDebtPrincipal = 0n;
  let transferInflow = 0n;
  let transferOutflow = 0n;
  let debtPrincipalInflow = 0n;
  let debtPrincipalOutflow = 0n;

  for (const tx of transactions) {
    if (!Number.isSafeInteger(tx.amount) || tx.amount <= 0) throw new Error('CASH_FLOW_ERR_UNSAFE_AMOUNT');
    const amount = BigInt(tx.amount);
    const isDebt =
      isDebtPrincipalCategory(tx.category_id) || isDebtPrincipalCategory(tx.category_name_key);

    if (tx.type === 'income') {
      grossExternalCashInflow += amount;
      if (isDebt) {
        debtPrincipalInflow += amount;
      } else {
        incomeExcludingDebtPrincipal += amount;
      }
    } else if (tx.type === 'expense') {
      grossExternalCashOutflow += amount;
      if (isDebt) {
        debtPrincipalOutflow += amount;
      } else {
        expenseExcludingDebtPrincipal += amount;
      }
    } else if (tx.type === 'transfer') {
      // Transfers shift money between accounts without altering net worth or income/expense
      if (tx.transfer_role === 'destination') {
        transferInflow += amount;
      } else if (tx.transfer_role === 'source') {
        transferOutflow += amount;
      }
    }
  }

  return {
    grossExternalCashInflow: safe(grossExternalCashInflow),
    incomeExcludingDebtPrincipal: safe(incomeExcludingDebtPrincipal),
    grossExternalCashOutflow: safe(grossExternalCashOutflow),
    expenseExcludingDebtPrincipal: safe(expenseExcludingDebtPrincipal),
    transferInflow: safe(transferInflow),
    transferOutflow: safe(transferOutflow),
    debtPrincipalInflow: safe(debtPrincipalInflow),
    debtPrincipalOutflow: safe(debtPrincipalOutflow),
  };
}

function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CASH_FLOW_ERR_AGGREGATE_OVERFLOW');
  return Number(value);
}
