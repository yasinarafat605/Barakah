/**
 * Barakah Money Domain Value Object
 * Strict rules:
 * - ADR-004 / Rule 1: Money is ALWAYS an integer in minor units (paisa/cents).
 *   Never floating-point. No rounding ambiguities.
 * - ADR-005 / Rule 2: Balances are derived, never stored.
 * - Supports BDT default and dual-numeral formatting (English and Bangla).
 */

export const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

export const CURRENCY_SYMBOLS: Record<string, string> = {
  BDT: '৳',
  USD: '$',
  GBP: '£',
  EUR: '€',
  SAR: 'SAR ',
  AED: 'AED ',
  MYR: 'RM ',
  INR: '₹',
  PKR: 'Rs ',
};

export const CURRENCY_FRACTION_DIGITS = {
  BDT: 2, USD: 2, GBP: 2, EUR: 2, SAR: 2, AED: 2, MYR: 2, INR: 2, PKR: 2,
} as const;
export type SupportedCurrency = keyof typeof CURRENCY_FRACTION_DIGITS;
export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_FRACTION_DIGITS) as SupportedCurrency[];

export function isSupportedCurrency(currency: string): currency is SupportedCurrency {
  return Object.prototype.hasOwnProperty.call(CURRENCY_FRACTION_DIGITS, currency.trim().toUpperCase());
}

export function getCurrencyFractionDigits(currency: string): number {
  const normalized = currency.trim().toUpperCase();
  if (!isSupportedCurrency(normalized)) throw new Error('MONEY_ERR_UNSUPPORTED_CURRENCY');
  return CURRENCY_FRACTION_DIGITS[normalized];
}

/**
 * Converts any Latin digits (0-9) in a string to Bengali numerals (০-৯).
 */
export function toBengaliNumerals(strOrNum: string | number): string {
  return String(strOrNum).replace(/[0-9]/g, (digit) => BENGALI_DIGITS[parseInt(digit, 10)]);
}

/**
 * Converts Bengali digits (০-৯) to Latin digits (0-9).
 */
export function fromBengaliNumerals(str: string): string {
  return String(str).replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
}

export type MoneyParseError =
  | 'empty'
  | 'whitespace'
  | 'signed'
  | 'exponent'
  | 'mixed_separators'
  | 'multiple_decimals'
  | 'invalid_format'
  | 'too_many_decimals'
  | 'zero_or_negative'
  | 'exceeds_bounds';

export interface MoneyParseResult {
  valid: boolean;
  amountMinor: number;
  error?: MoneyParseError;
}

/**
 * Parses monetary input string into integer minor units without floating-point arithmetic.
 * Conforms strictly to:
 * - Bengali and Latin digits accepted.
 * - '.' or ',' accepted as decimal separator.
 * - Input containing both '.' and ',' rejected as ambiguous.
 * - Grouping separators rejected.
 * - Max fractional digits enforced based on currency (default 2).
 * - Exponent notation rejected.
 * - Signs (+, -) rejected.
 * - Internal whitespace rejected.
 * - Zero and negative amounts rejected.
 * - Values exceeding JS safe integer range (Number.MAX_SAFE_INTEGER) rejected.
 */
export function parseMoneyInput(rawInput: string, currencyOrDecimalPlaces: string | number = 'BDT'): MoneyParseResult {
  const decimalPlaces = typeof currencyOrDecimalPlaces === 'number'
    ? currencyOrDecimalPlaces
    : getCurrencyFractionDigits(currencyOrDecimalPlaces);
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, amountMinor: 0, error: 'empty' };
  }

  // Reject internal whitespace
  if (/\s/.test(trimmed)) {
    return { valid: false, amountMinor: 0, error: 'whitespace' };
  }

  // Reject signs
  if (/[-+]/.test(trimmed)) {
    return { valid: false, amountMinor: 0, error: 'signed' };
  }

  // Reject exponent notation
  if (/[eE]/.test(trimmed)) {
    return { valid: false, amountMinor: 0, error: 'exponent' };
  }

  // Convert Bengali numerals to Latin
  const normalized = fromBengaliNumerals(trimmed);

  // Reject mixed decimal separators
  const hasDot = normalized.includes('.');
  const hasComma = normalized.includes(',');
  if (hasDot && hasComma) {
    return { valid: false, amountMinor: 0, error: 'mixed_separators' };
  }

  // Reject multiple decimal/separator occurrences (e.g. 1,000,000 or 1.2.3)
  const dotCount = (normalized.match(/\./g) || []).length;
  const commaCount = (normalized.match(/,/g) || []).length;
  if (dotCount > 1 || commaCount > 1) {
    return { valid: false, amountMinor: 0, error: 'multiple_decimals' };
  }

  // Unify decimal separator to dot
  const unified = normalized.replace(',', '.');

  // Verify only digits and optional single dot
  if (!/^\d+(\.\d*)?$/.test(unified) && !/^\.\d+$/.test(unified)) {
    return { valid: false, amountMinor: 0, error: 'invalid_format' };
  }

  const [intPart = '', fracPart = ''] = unified.split('.');

  if (fracPart.length > decimalPlaces) {
    return { valid: false, amountMinor: 0, error: 'too_many_decimals' };
  }

  // Calculate minor units strictly with integer string padding
  const paddedFrac = fracPart.padEnd(decimalPlaces, '0');
  const intBig = intPart ? BigInt(intPart) : 0n;
  const fracBig = paddedFrac ? BigInt(paddedFrac) : 0n;
  const multiplier = 10n ** BigInt(decimalPlaces);
  const totalMinorBig = intBig * multiplier + fracBig;

  if (totalMinorBig <= 0n) {
    return { valid: false, amountMinor: 0, error: 'zero_or_negative' };
  }

  if (totalMinorBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { valid: false, amountMinor: 0, error: 'exceeds_bounds' };
  }

  return {
    valid: true,
    amountMinor: Number(totalMinorBig),
  };
}

function groupIntegerDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatMinorUnits(amountMinor: number | bigint, currency: string, locale: 'bn' | 'en' = 'en'): string {
  const normalizedCurrency = currency.trim().toUpperCase();
  const fractionDigits = getCurrencyFractionDigits(normalizedCurrency);
  if (typeof amountMinor === 'number' && !Number.isSafeInteger(amountMinor)) throw new RangeError('MONEY_ERR_UNSAFE_AMOUNT');
  const value = typeof amountMinor === 'bigint' ? amountMinor : BigInt(amountMinor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = 10n ** BigInt(fractionDigits);
  const major = absolute / divisor;
  const fraction = absolute % divisor;
  const numeric = fractionDigits === 0
    ? groupIntegerDigits(major.toString())
    : `${groupIntegerDigits(major.toString())}.${fraction.toString().padStart(fractionDigits, '0')}`;
  const localized = locale === 'bn' ? toBengaliNumerals(numeric) : numeric;
  const symbol = CURRENCY_SYMBOLS[normalizedCurrency] ?? `${normalizedCurrency} `;
  return `${negative ? '-' : ''}${symbol}${localized}`;
}

export function formatBasisPoints(basisPoints: number, locale: 'bn' | 'en' = 'en'): string {
  if (!Number.isSafeInteger(basisPoints)) throw new RangeError('MONEY_ERR_UNSAFE_BASIS_POINTS');
  const value = BigInt(basisPoints);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const text = `${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}%`;
  return `${negative ? '-' : ''}${locale === 'bn' ? toBengaliNumerals(text) : text}`;
}

export class Money {
  readonly amount: number;
  readonly currency: string;

  constructor(amount: number | bigint, currency: string = 'BDT') {
    let minorUnits: number;

    if (typeof amount === 'bigint') {
      if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new RangeError(`Money amount bigint exceeds safe integer range: ${amount}`);
      }
      minorUnits = Number(amount);
    } else if (typeof amount === 'number') {
      if (!Number.isInteger(amount)) {
        throw new TypeError(
          `Money amount must be an integer representing minor units (no floats allowed). Received: ${amount}`
        );
      }
      if (!Number.isSafeInteger(amount)) {
        throw new RangeError(`Money amount must be a safe integer. Received: ${amount}`);
      }
      minorUnits = amount;
    } else {
      throw new TypeError(`Money amount must be a number or bigint. Received: ${typeof amount}`);
    }

    this.amount = minorUnits;
    this.currency = currency.trim().toUpperCase();
    getCurrencyFractionDigits(this.currency);
    Object.freeze(this);
  }

  // Factory methods
  static fromPoisha(poisha: number | bigint, currency: string = 'BDT'): Money {
    return new Money(poisha, currency);
  }

  static fromMajorUnits(taka: number, currency: string = 'BDT'): Money {
    if (typeof taka !== 'number' || Number.isNaN(taka) || !Number.isFinite(taka)) {
      throw new TypeError(`Major unit must be a finite number. Received: ${taka}`);
    }
    return new Money(Math.round(taka * 100), currency);
  }

  static zero(currency: string = 'BDT'): Money {
    return new Money(0, currency);
  }

  // Arithmetic operations (immutable)
  add(other: Money): Money {
    this.assertSameCurrency(other, 'add');
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, 'subtract');
    return new Money(this.amount - other.amount, this.currency);
  }

  multiply(scalar: number): Money {
    if (typeof scalar !== 'number' || Number.isNaN(scalar) || !Number.isFinite(scalar)) {
      throw new TypeError(`Multiplier scalar must be a finite number. Received: ${scalar}`);
    }
    const result = Math.round(this.amount * scalar);
    return new Money(result, this.currency);
  }

  /**
   * Distributes the money amount among ratios without losing a single poisha to rounding.
   */
  allocate(ratios: number[]): Money[] {
    if (!ratios.length || ratios.some((r) => r < 0 || typeof r !== 'number' || !Number.isFinite(r))) {
      throw new Error('Ratios must be an array of non-negative finite numbers with length > 0');
    }
    const total = ratios.reduce((sum, r) => sum + r, 0);
    if (total === 0) {
      throw new Error('Total ratio sum must be greater than zero');
    }

    let remainder = this.amount;
    const results: Money[] = [];

    for (let i = 0; i < ratios.length; i++) {
      const share = Math.trunc((this.amount * ratios[i]) / total);
      results.push(new Money(share, this.currency));
      remainder -= share;
    }

    // Distribute remainder poisha one by one
    for (let i = 0; remainder !== 0; i = (i + 1) % ratios.length) {
      const step = remainder > 0 ? 1 : -1;
      results[i] = new Money(results[i].amount + step, this.currency);
      remainder -= step;
    }

    return results;
  }

  // Predicates
  isNegative(): boolean {
    return this.amount < 0;
  }

  isZero(): boolean {
    return this.amount === 0;
  }

  isPositive(): boolean {
    return this.amount > 0;
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  compare(other: Money): number {
    this.assertSameCurrency(other, 'compare');
    if (this.amount < other.amount) return -1;
    if (this.amount > other.amount) return 1;
    return 0;
  }

  toMajorUnits(): number {
    return this.amount / 100;
  }

  /**
   * Formats the monetary amount cleanly in English ('en') or Bangla ('bn') numerals.
   * e.g. 10050 poisha -> "৳১০০.৫০" (bn) or "৳100.50" (en).
   */
  format(locale: 'bn' | 'en' = 'bn'): string {
    return formatMinorUnits(this.amount, this.currency, locale);
  }

  private assertSameCurrency(other: Money, operation: string): void {
    if (this.currency !== other.currency) {
      throw new Error(`Cannot ${operation} Money with different currencies: ${this.currency} and ${other.currency}`);
    }
  }
}

export default Money;
