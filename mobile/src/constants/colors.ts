/**
 * Friday Amanah Brand Colors and Semantic Tokens
 * Source of truth: docs/09-design-system.md & Friday_Amanah_Brand_Assets
 */

export const BrandColors = {
  midnightNavy: '#0A1D37', // Ecosystem identity, dark surfaces, headings
  deepEmerald: '#087A62', // Primary emerald, actions on light surfaces
  emeraldGreen: '#10A981', // Brand emerald, fills, dark-mode actions
  freshMint: '#38D3A5', // Highlights, dark-mode accents
  trustGold: '#D2A74B', // LIMITED accent only
  mintWhite: '#EAF8F3', // Tinted surfaces, subtle positive backgrounds
  cloudWhite: '#F8FAFC', // App background
  charcoalText: '#1F2937', // Body text
  white: '#FFFFFF', // Cards, sheets, inputs
} as const;

export const SemanticColors = {
  light: {
    surface: BrandColors.white,
    surfaceSunken: BrandColors.cloudWhite,
    surfaceTinted: BrandColors.mintWhite,
    surfaceInverse: BrandColors.midnightNavy,

    textPrimary: BrandColors.midnightNavy,
    textBody: BrandColors.charcoalText,
    textSecondary: '#52606D',
    textTertiary: '#8A94A0',
    textOnEmerald: BrandColors.white,
    textOnNavy: BrandColors.cloudWhite,

    actionPrimary: BrandColors.deepEmerald,
    actionPrimaryPress: '#06614E',
    brandFill: BrandColors.emeraldGreen,
    accentHighlight: BrandColors.freshMint,
    accentGold: BrandColors.trustGold,

    border: '#DCE3EA',
    borderStrong: '#B6C1CC',

    // Financial direction
    moneyIn: BrandColors.deepEmerald,
    moneyOut: '#8A5A1E', // Gold-family brown
    moneyNeutral: '#52606D',
    destructive: '#B42318',
  },
  dark: {
    surface: BrandColors.midnightNavy,
    surfaceSunken: '#06121F',
    surfaceRaised: '#122C4E',
    surfaceTinted: '#0C2A24',

    textPrimary: BrandColors.cloudWhite,
    textBody: BrandColors.mintWhite,
    textSecondary: '#9FB0C0',
    textTertiary: '#6B7C8E',
    textOnEmerald: BrandColors.white,
    textOnNavy: BrandColors.cloudWhite,

    actionPrimary: BrandColors.emeraldGreen,
    actionPrimaryPress: '#0D8E6C',
    brandFill: BrandColors.deepEmerald,
    accentHighlight: BrandColors.freshMint,
    accentGold: BrandColors.trustGold,

    border: '#1E3557',
    borderStrong: '#2A466F',

    // Financial direction
    moneyIn: BrandColors.freshMint,
    moneyOut: BrandColors.trustGold,
    moneyNeutral: '#9FB0C0',
    destructive: '#F97066',
  },
} as const;
