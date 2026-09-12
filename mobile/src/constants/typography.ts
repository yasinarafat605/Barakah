/**
 * Friday Amanah Typography Tokens
 * Source of truth: docs/09-design-system.md §4
 */

export const Typography = {
  fontFamilies: {
    display: 'Poppins', // Headings, onboarding, screen titles
    body: 'Inter', // Working text, tables, amounts, forms
    bengali: 'Noto Sans Bengali', // Bangla text substitution
  },
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
  lineHeight: {
    xs: 16,
    sm: 20,
    base: 24,
    lg: 28,
    xl: 28,
    '2xl': 32,
    '3xl': 38,
    '4xl': 44,
  },
  // Bangla script requires additional vertical breathing room
  banglaLineHeightMultiplier: 1.25,
} as const;
