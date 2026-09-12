/**
 * Friday Amanah Brand Colors & Theme Constants
 * Source of truth: docs/09-design-system.md & Friday_Amanah_Brand_Assets
 */

import { BrandColors } from './colors';

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
    primary: BrandColors.deepEmerald, // #087A62 - AA compliant on light
    background: BrandColors.cloudWhite, // #F8FAFC - App background
    surface: BrandColors.white, // #FFFFFF - Cards, sheets, inputs
    surfaceTinted: BrandColors.mintWhite, // #EAF8F3 - Positive panels
    text: BrandColors.midnightNavy, // #0A1D37 - 16.14:1 AAA
    textMuted: '#52606D', // Charcoal tint secondary
    muted: '#8A94A0', // Tertiary
    border: '#DCE3EA', // Cloud White shaded
    error: '#B42318', // Destructive only
    success: BrandColors.deepEmerald, // Accessible green
    accent: BrandColors.trustGold, // #D2A74B - Trust Gold accent
    moneyIn: BrandColors.deepEmerald,
    moneyOut: '#8A5A1E', // Gold-family brown (doc 09 §3.4)
  },
  dark: {
    primary: BrandColors.emeraldGreen, // #10A981 - AA on dark surfaces
    background: '#06121F', // Navy -40%
    surface: BrandColors.midnightNavy, // #0A1D37 - Midnight Navy
    surfaceTinted: '#0C2A24', // Deep Emerald @18% over navy
    text: BrandColors.cloudWhite, // #F8FAFC - 16.14:1 AAA
    textMuted: '#9FB0C0', // Secondary on dark
    muted: '#6B7C8E', // Tertiary
    border: '#1E3557', // Border
    error: '#F97066', // Accessible destructive on dark
    success: BrandColors.freshMint, // #38D3A5 - 8.87:1 AAA
    accent: BrandColors.trustGold, // #D2A74B
    moneyIn: BrandColors.freshMint,
    moneyOut: BrandColors.trustGold,
  },
};

export default Colors;
