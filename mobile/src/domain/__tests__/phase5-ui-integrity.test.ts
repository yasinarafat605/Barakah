import fs from 'fs';
import path from 'path';
import en from '../../locales/en/common.json';
import bn from '../../locales/bn/common.json';
import { planningErrorKey, planningErrorMessage } from '../planning-error';

const route = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../../../app', relative), 'utf8');
const keys = (value: unknown, prefix = ''): string[] => Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
  const next = prefix ? `${prefix}.${key}` : key;
  return child && typeof child === 'object' ? keys(child, next) : [next];
});

describe('Phase 5 planning UI integrity', () => {
  const sources = [route('plan/budgets/new.tsx'), route('plan/budgets/[id].tsx'), route('plan/goals/new.tsx'), route('plan/goals/[id].tsx'), route('plan/goals/[id]/entry.tsx'), route('(tabs)/plan.tsx')];

  it('uses integer-only financial display across planning routes', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/\.toFixed\s*\(|parseFloat\s*\(|\/\s*100\b/);
    }
    expect(sources.join('\n')).toContain('formatMinorUnits');
  });

  it('guards create and entry flows against double submission', () => {
    for (const source of [sources[0], sources[2], sources[4]]) {
      expect(source).toContain('submitting.current');
      expect(source).toMatch(/if\(submitting\.current/);
    }
  });

  it('exposes all three supported goal entry service modes', () => {
    expect(sources[4]).toContain("'allocation_only','existing_transfer','owned_transfer'");
    expect(sources[4]).toContain('recordGoalAllocation');
    expect(sources[4]).toContain('linkExistingTransferToGoal');
    expect(sources[4]).toContain('recordOwnedGoalTransfer');
  });

  it('renders localised user-safe errors without leaking internal codes', () => {
    expect(planningErrorKey(new Error('BUDGET_ERR_ACTIVITY_LOCKED_DUPLICATE_AND_ARCHIVE'))).toBe('planning.errors.activityLocked');
    expect(planningErrorMessage(new Error('GOAL_ERR_OVER_WITHDRAWAL'), (key) => `translated:${key}`)).toBe('translated:planning.errors.overWithdrawal');
    expect(planningErrorKey(new Error('arbitrary SQLite detail'))).toBe('planning.errors.generic');
  });

  it('keeps English and Bengali translation key parity', () => {
    expect(keys(bn).sort()).toEqual(keys(en).sort());
  });
});
