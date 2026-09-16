const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidCivilDate(value: string | null | undefined): value is string {
  if (!value) return false;
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function assertCivilDate(value: string, fieldName: string = 'date'): void {
  if (!isValidCivilDate(value)) {
    throw new Error(`${fieldName} must be a valid civil date in YYYY-MM-DD format.`);
  }
}

export function localCivilDateFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isSafeInteger(timestamp) || Number.isNaN(date.getTime())) {
    throw new Error('Timestamp must be a valid safe integer.');
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

export function utcCivilDateFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isSafeInteger(timestamp) || Number.isNaN(date.getTime())) {
    throw new Error('Timestamp must be a valid safe integer.');
  }
  return date.toISOString().slice(0, 10);
}
