export type TranslationLookup = (key: string) => string;

const ERROR_KEYS: [RegExp, string][] = [
  [/OVERLAPPING_SCOPE/, 'planning.errors.overlap'],
  [/ACTIVITY_LOCKED/, 'planning.errors.activityLocked'],
  [/ARCHIVED/, 'planning.errors.archived'],
  [/TARGET_REQUIRED/, 'planning.errors.targetRequired'],
  [/ROLLOVER/, 'planning.errors.rollover'],
  [/INVALID.*DATE|INVALID_CIVIL_DATE/, 'planning.errors.invalidDate'],
  [/CURRENCY/, 'planning.errors.currency'],
  [/EXCEEDS_AVAILABLE/, 'planning.errors.insufficientAvailable'],
  [/OVER_WITHDRAWAL/, 'planning.errors.overWithdrawal'],
  [/LINKED_ACCOUNT_REQUIRED/, 'planning.errors.accountRequired'],
  [/TRANSFER/, 'planning.errors.transfer'],
  [/FUNDED_GOAL_CANNOT_DELETE/, 'planning.errors.fundedGoalDelete'],
  [/UNSAFE|safe integer/i, 'planning.errors.unsafeNumber'],
  [/CONFIRMATION_REQUIRED/, 'planning.errors.confirmationRequired'],
];

export function planningErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return ERROR_KEYS.find(([pattern]) => pattern.test(message))?.[1] ?? 'planning.errors.generic';
}

export function planningErrorMessage(error: unknown, translate: TranslationLookup): string {
  return translate(planningErrorKey(error));
}
