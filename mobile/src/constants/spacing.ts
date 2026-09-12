/**
 * Barakah Spacing and Layout Tokens
 * Source of truth: docs/09-design-system.md
 */

export const Spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
} as const;

export const Radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  full: 9999,
} as const;

export const TouchTargets = {
  minimum: 44,
  recommended: 48,
  pinPad: 64,
} as const;
