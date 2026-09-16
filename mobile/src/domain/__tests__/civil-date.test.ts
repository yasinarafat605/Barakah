import { isValidCivilDate, utcCivilDateFromTimestamp } from '../civil-date';

describe('stable civil-date policy',()=>{
  it('validates real month-end, year-end and leap-day boundaries',()=>{
    expect(isValidCivilDate('2026-01-31')).toBe(true);
    expect(isValidCivilDate('2026-12-31')).toBe(true);
    expect(isValidCivilDate('2024-02-29')).toBe(true);
    expect(isValidCivilDate('2025-02-29')).toBe(false);
    expect(isValidCivilDate('2026-04-31')).toBe(false);
  });
  it('uses timezone-independent UTC only for legacy backfill instants',()=>{
    expect(utcCivilDateFromTimestamp(Date.parse('2024-01-01T00:30:00+14:00'))).toBe('2023-12-31');
    expect(utcCivilDateFromTimestamp(Date.parse('2024-03-10T07:30:00Z'))).toBe('2024-03-10');
  });
});
