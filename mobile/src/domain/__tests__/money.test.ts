import { formatMinorUnits, Money, toBengaliNumerals } from '../money';

describe('Money Domain Value Object (ADR-004)', () => {
  describe('Float rejection upon instantiation', () => {
    it('throws an error when a floating point number is passed', () => {
      expect(() => new Money(100.5)).toThrow(TypeError);
      expect(() => new Money(0.1)).toThrow(TypeError);
      expect(() => new Money(1234.567)).toThrow(TypeError);
      expect(() => new Money(-50.25)).toThrow(TypeError);
    });

    it('throws an error for non-finite numbers', () => {
      expect(() => new Money(NaN)).toThrow(TypeError);
      expect(() => new Money(Infinity)).toThrow(TypeError);
      expect(() => new Money(-Infinity)).toThrow(TypeError);
    });

    it('throws an error for non-number/non-bigint values', () => {
      // @ts-expect-error testing runtime validation
      expect(() => new Money('10000')).toThrow(TypeError);
      // @ts-expect-error testing runtime validation
      expect(() => new Money(null)).toThrow(TypeError);
      // @ts-expect-error testing runtime validation
      expect(() => new Money(undefined)).toThrow(TypeError);
    });

    it('accepts clean integers in minor units', () => {
      const m1 = new Money(10050);
      expect(m1.amount).toBe(10050);
      expect(m1.currency).toBe('BDT');

      const zero = new Money(0);
      expect(zero.amount).toBe(0);

      const neg = new Money(-500);
      expect(neg.amount).toBe(-500);
    });

    it('accepts bigint representations of minor units', () => {
      const m = new Money(BigInt(10050));
      expect(m.amount).toBe(10050);
    });

    it('is immutable (frozen)', () => {
      const m = new Money(1000);
      expect(Object.isFrozen(m)).toBe(true);
      expect(() => {
        'use strict';
        // @ts-expect-error attempting to mutate readonly property
        m.amount = 2000;
      }).toThrow(TypeError);
    });
  });

  describe('Exact arithmetic without floating-point drift', () => {
    it('avoids classic floating point drift: 10 poisha + 20 poisha = exactly 30 poisha', () => {
      const ten = new Money(10);
      const twenty = new Money(20);
      const result = ten.add(twenty);

      expect(result.amount).toBe(30);
      expect(result.currency).toBe('BDT');
    });

    it('accumulates repeated additions with exact integer arithmetic', () => {
      let total = Money.zero();
      for (let i = 0; i < 10; i++) {
        total = total.add(new Money(10));
      }
      expect(total.amount).toBe(100);
      expect(total.toMajorUnits()).toBe(1);
    });

    it('subtracts cleanly, including transitions to negative balances', () => {
      const balance = new Money(10000); // 100 BDT
      const expense = new Money(15000); // 150 BDT
      const result = balance.subtract(expense);

      expect(result.amount).toBe(-5000);
      expect(result.isNegative()).toBe(true);
      expect(result.isZero()).toBe(false);
    });

    it('refuses addition and subtraction across different currencies', () => {
      const bdt = new Money(1000, 'BDT');
      const usd = new Money(1000, 'USD');

      expect(() => bdt.add(usd)).toThrow('Cannot add Money with different currencies');
      expect(() => bdt.subtract(usd)).toThrow('Cannot subtract Money with different currencies');
      expect(() => bdt.compare(usd)).toThrow('Cannot compare Money with different currencies');
    });

    it('multiplies by scalar with deterministic rounding to integer minor units', () => {
      const m = new Money(100); // 1.00 BDT
      const half = m.multiply(0.5);
      expect(half.amount).toBe(50);

      const third = new Money(100).multiply(1 / 3);
      expect(third.amount).toBe(33); // 33.3333 rounded to 33
    });

    it('allocates ratios without losing a single poisha to rounding', () => {
      const hundred = new Money(100); // 100 poisha
      // Distribute equally 1:1:1
      const shares = hundred.allocate([1, 1, 1]);

      expect(shares).toHaveLength(3);
      expect(shares[0].amount).toBe(34);
      expect(shares[1].amount).toBe(33);
      expect(shares[2].amount).toBe(33);

      const sum = shares.reduce((acc, s) => acc + s.amount, 0);
      expect(sum).toBe(100); // Perfectly conserved
    });

    it('compares amounts correctly', () => {
      const a = new Money(100);
      const b = new Money(200);
      const c = new Money(100);

      expect(a.compare(b)).toBe(-1);
      expect(b.compare(a)).toBe(1);
      expect(a.compare(c)).toBe(0);
      expect(a.equals(c)).toBe(true);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('Locale formatting for Bangla and English', () => {
    it('renders integer-only Phase 5 financial displays in English and Bengali', () => {
      expect(formatMinorUnits(9007199254740991, 'USD', 'en')).toBe('$90,071,992,547,409.91');
      expect(formatMinorUnits(12345, 'BDT', 'bn')).toBe(`৳${toBengaliNumerals('123.45')}`);
      expect(() => formatMinorUnits(Number.MAX_SAFE_INTEGER + 1, 'GBP')).toThrow('MONEY_ERR_UNSAFE_AMOUNT');
    });
    it('formats 10050 poisha into ৳100.50 (English) and ৳১০০.৫০ (Bangla)', () => {
      const m = new Money(10050);
      expect(m.format('en')).toBe('৳100.50');
      expect(m.format('bn')).toBe('৳১০০.৫০');
    });

    it('formats zero correctly in both locales', () => {
      const zero = Money.zero();
      expect(zero.format('en')).toBe('৳0.00');
      expect(zero.format('bn')).toBe('৳০.০০');
    });

    it('formats single-digit poisha with leading zero', () => {
      const fivePoisha = new Money(5);
      expect(fivePoisha.format('en')).toBe('৳0.05');
      expect(fivePoisha.format('bn')).toBe('৳০.০৫');

      const fiftyPoisha = new Money(50);
      expect(fiftyPoisha.format('en')).toBe('৳0.50');
      expect(fiftyPoisha.format('bn')).toBe('৳০.৫০');
    });

    it('formats negative amounts with correct sign placement', () => {
      const neg = new Money(-10050);
      expect(neg.format('en')).toBe('-৳100.50');
      expect(neg.format('bn')).toBe('-৳১০০.৫০');
    });

    it('formats large values with thousand comma separators', () => {
      const lakh = new Money(10000000); // 100,000.00 BDT
      expect(lakh.format('en')).toBe('৳100,000.00');
      expect(lakh.format('bn')).toBe('৳১০০,০০০.০০');
    });

    it('formats other currencies with appropriate symbols', () => {
      const usd = new Money(1250, 'USD');
      expect(usd.format('en')).toBe('$12.50');

      const gbp = new Money(500, 'GBP');
      expect(gbp.format('en')).toBe('£5.00');
    });

    it('defaults to Bangla locale when no argument is passed', () => {
      const m = new Money(10050);
      expect(m.format()).toBe('৳১০০.৫০');
    });

    it('toBengaliNumerals utility converts all Latin digits', () => {
      expect(toBengaliNumerals('0123456789')).toBe('০১২৩৪৫৬৭৮৯');
      expect(toBengaliNumerals('Amount: 1,250.75 BDT')).toBe('Amount: ১,২৫০.৭৫ BDT');
    });
  });
});
