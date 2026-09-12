/**
 * Barakah Brand Colors and Semantic Tokens
 * Source of truth: Barakah_Brand_Assets_v1/07_Developer/design-tokens.json & colors.json
 */

export const BarakahColors = {
  emerald: '#0B6B57', // Primary brand colour
  midnight: '#102A43', // Midnight navy/green
  warmIvory: '#F7F8F4', // Calm app background
  white: '#FFFFFF', // Surfaces, cards, inputs
  charcoal: '#17211D', // Primary body text
  mutedSlate: '#5E6C65', // Secondary text
  gold: '#D6B15B', // Barakah Gold accent (Zakat, savings)
  softMint: '#E3F3ED', // Soft positive tinted surfaces
  softSand: '#F5EEDC', // Warm accent surface
  coolBorder: '#DCE5E1', // Structural borders
  income: '#087A62', // Semantic income
  expense: '#B5473A', // Semantic expense
  receivable: '#2F6FED', // Semantic receivable
  payable: '#8A5A1E', // Semantic payable
  zakat: '#7A4FB3', // Semantic Zakat
  warning: '#B86E00', // Warning state
  critical: '#B42318', // Critical / destructive
  darkBackground: '#071915', // Dark mode background
  darkSurface: '#0E2721', // Dark mode surface
  darkPrimary: '#5DDBB7', // Dark mode primary action
} as const;

// Backward-compatibility alias for existing components
export const BrandColors = {
  midnightNavy: BarakahColors.midnight, // '#102A43'
  deepEmerald: BarakahColors.emerald, // '#0B6B57'
  emeraldGreen: BarakahColors.darkPrimary, // '#5DDBB7'
  freshMint: BarakahColors.softMint, // '#E3F3ED'
  trustGold: BarakahColors.gold, // '#D6B15B'
  mintWhite: BarakahColors.softMint, // '#E3F3ED'
  cloudWhite: BarakahColors.warmIvory, // '#F7F8F4'
  charcoalText: BarakahColors.charcoal, // '#17211D'
  white: BarakahColors.white, // '#FFFFFF'
} as const;

export const SemanticColors = {
  light: {
    surface: BarakahColors.white,
    surfaceSunken: BarakahColors.warmIvory,
    surfaceTinted: BarakahColors.softMint,
    surfaceInverse: BarakahColors.midnight,

    textPrimary: BarakahColors.charcoal,
    textBody: BarakahColors.charcoal,
    textSecondary: BarakahColors.mutedSlate,
    textTertiary: '#8A94A0',
    textOnEmerald: BarakahColors.white,
    textOnNavy: BarakahColors.warmIvory,

    actionPrimary: BarakahColors.emerald,
    actionPrimaryPress: '#085243',
    brandFill: BarakahColors.emerald,
    accentHighlight: BarakahColors.softMint,
    accentGold: BarakahColors.gold,

    border: BarakahColors.coolBorder,
    borderStrong: '#B6C1CC',

    // Financial direction
    moneyIn: BarakahColors.income,
    moneyOut: BarakahColors.expense,
    receivable: BarakahColors.receivable,
    payable: BarakahColors.payable,
    zakat: BarakahColors.zakat,
    moneyNeutral: BarakahColors.mutedSlate,
    destructive: BarakahColors.critical,
  },
  dark: {
    surface: BarakahColors.darkSurface,
    surfaceSunken: BarakahColors.darkBackground,
    surfaceRaised: BarakahColors.midnight,
    surfaceTinted: '#0E2721',

    textPrimary: BarakahColors.warmIvory,
    textBody: BarakahColors.softMint,
    textSecondary: '#9FB0C0',
    textTertiary: '#6B7C8E',
    textOnEmerald: BarakahColors.white,
    textOnNavy: BarakahColors.warmIvory,

    actionPrimary: BarakahColors.darkPrimary,
    actionPrimaryPress: '#46C29E',
    brandFill: BarakahColors.emerald,
    accentHighlight: BarakahColors.softMint,
    accentGold: BarakahColors.gold,

    border: '#1E3557',
    borderStrong: '#2A466F',

    // Financial direction
    moneyIn: BarakahColors.darkPrimary,
    moneyOut: BarakahColors.gold,
    receivable: '#6AA2FF',
    payable: BarakahColors.gold,
    zakat: '#A77EE3',
    moneyNeutral: '#9FB0C0',
    destructive: '#F97066',
  },
} as const;
