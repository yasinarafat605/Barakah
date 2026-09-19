export class FinancialIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinancialIntegrityError';
  }
}

export function toFinancialBigInt(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new FinancialIntegrityError(`${label} is outside the safe integer boundary.`);
  }
  return BigInt(value);
}

export function toSafeFinancialNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new FinancialIntegrityError(`${label} exceeds the safe integer boundary.`);
  }
  return Number(value);
}

export function coerceSafeFinancialInteger(value: unknown, label: string): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new FinancialIntegrityError(`${label} is outside the safe integer boundary.`);
    }
    return value;
  }
  if (typeof value === 'bigint') return toSafeFinancialNumber(value, label);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return toSafeFinancialNumber(BigInt(value), label);
  }
  throw new FinancialIntegrityError(`${label} is not an integer minor-unit value.`);
}

export function sumFinancialValues(values: readonly number[], label: string): number {
  const total = values.reduce((sum, value, index) => sum + toFinancialBigInt(value, `${label}[${index}]`), 0n);
  return toSafeFinancialNumber(total, label);
}

export function progressBasisPoints(current: number, target: number): number {
  const currentBig = toFinancialBigInt(current, 'current');
  const targetBig = toFinancialBigInt(target, 'target');
  if (currentBig < 0n || targetBig <= 0n) {
    throw new FinancialIntegrityError('Progress requires a non-negative current amount and positive target.');
  }
  return toSafeFinancialNumber((currentBig * 10_000n) / targetBig, 'progress basis points');
}

export function ceilDivideFinancial(value: number, divisor: number): number {
  const valueBig = toFinancialBigInt(value, 'value');
  const divisorBig = toFinancialBigInt(divisor, 'divisor');
  if (valueBig < 0n || divisorBig <= 0n) {
    throw new FinancialIntegrityError('Ceiling division requires a non-negative value and positive divisor.');
  }
  return toSafeFinancialNumber((valueBig + divisorBig - 1n) / divisorBig, 'ceiling division');
}
