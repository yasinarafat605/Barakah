/**
 * Barakah Brand Colors & Theme Constants
 * Source of truth: Barakah_Brand_Assets_v1/07_Developer/design-tokens.json
 */

import { BarakahColors } from './colors';

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  primary: string;
  background: string;
  surface: string;
  surfaceTinted: string;
  text: string;
  textMuted: string;
  muted: string;
  border: string;
  error: string;
  success: string;
  accent: string;
  moneyIn: string;
  moneyOut: string;
}

export const Colors: Record<ThemeMode, ThemeColors> = {
  light: {
    primary: BarakahColors.emerald, // #0B6B57 - Primary brand action
    background: BarakahColors.warmIvory, // #F7F8F4 - Calm Warm Ivory background
    surface: BarakahColors.white, // #FFFFFF - Cards, sheets, inputs
    surfaceTinted: BarakahColors.softMint, // #E3F3ED - Soft mint tinted panels
    text: BarakahColors.charcoal, // #17211D - Charcoal primary text (15.6:1 AAA)
    textMuted: BarakahColors.mutedSlate, // #5E6C65 - Muted slate secondary text
    muted: '#8A94A0', // Tertiary
    border: BarakahColors.coolBorder, // #DCE5E1 - Cool border
    error: BarakahColors.critical, // #B42318 - Destructive
    success: BarakahColors.income, // #087A62 - Accessible income green
    accent: BarakahColors.gold, // #D6B15B - Barakah Gold accent
    moneyIn: BarakahColors.income, // #087A62
    moneyOut: BarakahColors.expense, // #B5473A
  },
  dark: {
    primary: BarakahColors.darkPrimary, // #5DDBB7 - High contrast action on dark
    background: BarakahColors.darkBackground, // #071915 - Deep dark background
    surface: BarakahColors.darkSurface, // #0E2721 - Dark container surface
    surfaceTinted: BarakahColors.midnight, // #102A43 - Midnight green accent surface
    text: BarakahColors.warmIvory, // #F7F8F4 - Warm Ivory text (17.5:1 AAA)
    textMuted: '#9FB0C0', // Secondary on dark
    muted: '#6B7C8E', // Tertiary
    border: '#1E3557', // Dark border
    error: '#F97066', // Accessible destructive on dark
    success: BarakahColors.darkPrimary, // #5DDBB7 - High contrast green
    accent: BarakahColors.gold, // #D6B15B - Gold accent
    moneyIn: BarakahColors.darkPrimary,
    moneyOut: BarakahColors.gold,
  },
};

export default Colors;
