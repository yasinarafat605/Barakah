import React from 'react';
import {
  Image,
  StyleSheet,
  View,
  ViewStyle,
  ImageStyle,
  StyleProp,
} from 'react-native';

export type BrandMarkVariant = 'icon' | 'horizontal' | 'stacked' | 'primary' | 'symbol';

export interface BrandMarkProps {
  /**
   * Barakah brand lockup variant
   * - 'icon' / 'symbol': Geometric B mark with growth leaf (1024×1024 master, min 24px)
   * - 'horizontal': Horizontal wordmark lockup (1800×520 master, min 120px wide)
   * - 'stacked': Stacked lockup (1200×1400 master, min 96px wide)
   * - 'primary': Full primary brand lockup
   */
  variant?: BrandMarkVariant;
  /**
   * Whether to render reverse artwork for dark surfaces
   */
  reverse?: boolean;
  /**
   * Target display width or height depending on layout context
   */
  width?: number;
  height?: number;
  /**
   * Accessibility label for screen readers. Never empty. Defaults to 'Barakah'.
   */
  accessibilityLabel?: string;
  /**
   * Enforce >= 25% clear space padding around the mark (Barakah Brand Guidelines §Logo)
   */
  clearSpace?: boolean;
  /**
   * Additional style container
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Additional image style
   */
  imageStyle?: StyleProp<ImageStyle>;
}

// Master Barakah Brand constraints and asset mappings
const BRAND_CONSTRAINTS: Record<
  BrandMarkVariant,
  {
    standardSource: any;
    reverseSource: any;
    aspectRatio: number; // width / height
    minWidth: number;
    minHeight: number;
    defaultWidth: number;
    defaultHeight: number;
  }
> = {
  icon: {
    standardSource: require('@/assets/images/mark.png'),
    reverseSource: require('@/assets/images/mark-reverse.png'),
    aspectRatio: 1, // 1024 x 1024
    minWidth: 24,
    minHeight: 24,
    defaultWidth: 32,
    defaultHeight: 32,
  },
  symbol: {
    standardSource: require('@/assets/images/mark.png'),
    reverseSource: require('@/assets/images/mark-reverse.png'),
    aspectRatio: 1, // 1024 x 1024
    minWidth: 24,
    minHeight: 24,
    defaultWidth: 32,
    defaultHeight: 32,
  },
  horizontal: {
    standardSource: require('@/assets/images/logo-horizontal.png'),
    reverseSource: require('@/assets/images/logo-horizontal-reverse.png'),
    aspectRatio: 1800 / 520, // ~3.4615
    minWidth: 120,
    minHeight: Math.round(120 / (1800 / 520)), // ~35px
    defaultWidth: 148,
    defaultHeight: Math.round(148 / (1800 / 520)), // ~43px
  },
  stacked: {
    standardSource: require('@/assets/images/logo-stacked.png'),
    reverseSource: require('@/assets/images/logo-stacked-reverse.png'),
    aspectRatio: 1200 / 1400, // ~0.8571
    minWidth: 96,
    minHeight: Math.round(96 / (1200 / 1400)), // ~112px
    defaultWidth: 120,
    defaultHeight: Math.round(120 / (1200 / 1400)), // ~140px
  },
  primary: {
    standardSource: require('@/assets/images/logo-horizontal.png'),
    reverseSource: require('@/assets/images/logo-horizontal-reverse.png'),
    aspectRatio: 1800 / 520, // ~3.4615
    minWidth: 120,
    minHeight: Math.round(120 / (1800 / 520)), // ~35px
    defaultWidth: 160,
    defaultHeight: Math.round(160 / (1800 / 520)), // ~46px
  },
};

/**
 * BrandMark
 * The authoritative visual component for rendering Barakah logos and marks.
 * Enforces brand clear-space and minimum-dimension rules in code.
 * Follows Barakah Brand Guidelines v1.
 */
export function BrandMark({
  variant = 'icon',
  reverse = false,
  width: propWidth,
  height: propHeight,
  accessibilityLabel = 'Barakah',
  clearSpace = false,
  style,
  imageStyle,
}: BrandMarkProps) {
  const config = BRAND_CONSTRAINTS[variant];
  const source = reverse ? config.reverseSource : config.standardSource;

  // Resolve final dimensions respecting aspect ratio and minimum sizes
  let finalWidth = config.defaultWidth;
  let finalHeight = config.defaultHeight;

  if (propWidth !== undefined && propHeight !== undefined) {
    finalWidth = Math.max(propWidth, config.minWidth);
    finalHeight = Math.max(propHeight, config.minHeight);
  } else if (propWidth !== undefined) {
    finalWidth = Math.max(propWidth, config.minWidth);
    finalHeight = Math.round(finalWidth / config.aspectRatio);
  } else if (propHeight !== undefined) {
    finalHeight = Math.max(propHeight, config.minHeight);
    finalWidth = Math.round(finalHeight * config.aspectRatio);
  }

  // Clear space: >= 25% of dimension per Barakah Brand Guidelines
  const clearSpacePadding = clearSpace ? Math.round(finalHeight * 0.25) : 0;

  return (
    <View
      style={[
        styles.container,
        clearSpace && { padding: clearSpacePadding },
        style,
      ]}
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}>
      <Image
        source={source}
        style={[
          {
            width: finalWidth,
            height: finalHeight,
          },
          imageStyle,
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default BrandMark;
