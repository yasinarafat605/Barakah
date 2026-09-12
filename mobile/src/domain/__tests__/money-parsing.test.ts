import { parseMoneyInput, fromBengaliNumerals, toBengaliNumerals } from '../money';

describe('Bilingual Money Parsing (ADR-004 & Milestone 2 Specs)', () => {
  describe('fromBengaliNumerals and toBengaliNumerals', () => {
    it('converts Bengali numerals to Latin numerals correctly', () => {
      expect(fromBengaliNumerals('০১২৩৪৫৬৭৮৯')).toBe('0123456789');
      expect(fromBengaliNumerals('১২৫.৭৫')).toBe('125.75');
    });

    it('converts Latin numerals to Bengali numerals correctly', () => {
      expect(toBengaliNumerals('0123456789')).toBe('০১২৩৪৫৬৭৮৯');
      expect(toBengaliNumerals('125.75')).toBe('১২৫.৭৫');
    });
  });

  describe('parseMoneyInput valid inputs', () => {
    it('parses valid Bengali numerals with dot separator', () => {
      const result = parseMoneyInput('১০০.৫০');
      expect(result).toEqual({ valid: true, amountMinor: 10050 });
    });

    it('parses valid Latin numerals with dot separator', () => {
      const result = parseMoneyInput('100.50');
      expect(result).toEqual({ valid: true, amountMinor: 10050 });
    });

    it('parses valid Latin numerals with comma separator', () => {
      const result = parseMoneyInput('100,50');
      expect(result).toEqual({ valid: true, amountMinor: 10050 });
    });

    it('parses valid Bengali numerals with comma separator', () => {
      const result = parseMoneyInput('১০০,৫০');
      expect(result).toEqual({ valid: true, amountMinor: 10050 });
    });

    it('parses integer amount without decimal part', () => {
      expect(parseMoneyInput('50')).toEqual({ valid: true, amountMinor: 5000 });
      expect(parseMoneyInput('৫০')).toEqual({ valid: true, amountMinor: 5000 });
    });

    it('parses single decimal place by padding to minor units', () => {
      expect(parseMoneyInput('50.5')).toEqual({ valid: true, amountMinor: 5050 });
      expect(parseMoneyInput('৫০.৫')).toEqual({ valid: true, amountMinor: 5050 });
    });

    it('parses amount with leading/trailing whitespace after trimming', () => {
      expect(parseMoneyInput('  150.25  ')).toEqual({ valid: true, amountMinor: 15025 });
    });

    it('parses minimum minor unit (0.01 / 1 poisha)', () => {
      expect(parseMoneyInput('0.01')).toEqual({ valid: true, amountMinor: 1 });
      expect(parseMoneyInput('.01')).toEqual({ valid: true, amountMinor: 1 });
      expect(parseMoneyInput('০.০১')).toEqual({ valid: true, amountMinor: 1 });
    });
  });

  describe('parseMoneyInput rejection rules (Point 6)', () => {
    it('rejects ambiguous mixed separators (e.g. 1,000.50 and ১,০০০.৫০)', () => {
      expect(parseMoneyInput('1,000.50')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'mixed_separators',
      });
      expect(parseMoneyInput('১,০০০.৫০')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'mixed_separators',
      });
    });

    it('rejects multiple decimal separators of same type', () => {
      expect(parseMoneyInput('1.000.50')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'multiple_decimals',
      });
      expect(parseMoneyInput('1,000,50')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'multiple_decimals',
      });
    });

    it('rejects exponent notation (e.g. 1e3)', () => {
      expect(parseMoneyInput('1e3')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'exponent',
      });
      expect(parseMoneyInput('2.5E4')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'exponent',
      });
    });

    it('rejects signed numbers (e.g. -100, +50)', () => {
      expect(parseMoneyInput('-100')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'signed',
      });
      expect(parseMoneyInput('+50')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'signed',
      });
    });

    it('rejects internal whitespace within the number', () => {
      expect(parseMoneyInput('10 0.50')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'whitespace',
      });
      expect(parseMoneyInput('1 000')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'whitespace',
      });
    });

    it('rejects zero amount (0, 0.00, 00, ০.০০)', () => {
      expect(parseMoneyInput('0')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'zero_or_negative',
      });
      expect(parseMoneyInput('0.00')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'zero_or_negative',
      });
      expect(parseMoneyInput('০')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'zero_or_negative',
      });
      expect(parseMoneyInput('০.০০')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'zero_or_negative',
      });
    });

    it('rejects more decimal places than currency supports', () => {
      expect(parseMoneyInput('100.555')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'too_many_decimals',
      });
    });

    it('rejects invalid formatting and non-numeric characters', () => {
      expect(parseMoneyInput('abc')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'invalid_format',
      });
      expect(parseMoneyInput('12.34a')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'invalid_format',
      });
      expect(parseMoneyInput('..')).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'multiple_decimals',
      });
    });

    it('rejects values exceeding JS safe integer bounds', () => {
      const huge = '99999999999999999999.00';
      expect(parseMoneyInput(huge)).toEqual({
        valid: false,
        amountMinor: 0,
        error: 'exceeds_bounds',
      });
    });
  });
});
