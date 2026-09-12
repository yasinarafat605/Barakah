import React from 'react';
import {
  Image,
  StyleSheet,
  View,
  ViewStyle,
  ImageStyle,
  StyleProp,
} from 'react-native';

export type BrandMarkVariant = 'icon' | 'horizontal' | 'stacked' | 'primary';

export interface BrandMarkProps {
  /**
   * Brand lockup variant per ADR-015 & doc 09 §2
   * - 'icon': Transparent shield mark (4096×4096 source, min 24px)
   * - 'horizontal': Horizontal wordmark lockup (3072×1114 source, min 120px wide)
   * - 'stacked': Stacked lockup (2048×2405 source, min 96px wide)
   * - 'primary': Full primary lockup (4096×1959 source, min 140px wide)
   */
  variant?: BrandMarkVariant;
  /**
   * Target display width or height depending on layout context
   */
  width?: number;
  height?: number;
  /**
   * Accessibility label for screen readers. Never empty.
   */
  accessibilityLabel?: string;
  /**
   * Enforce >= 25% clear space padding around the mark (doc 09 §2.5)
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

// Brand source dimensions & minimum sizing constraints (doc 09 §2.6)
const BRAND_CONSTRAINTS: Record<
  BrandMarkVariant,
  {
    source: any;
    aspectRatio: number; // width / height
    minWidth: number;
    minHeight: number;
    defaultWidth: number;
    defaultHeight: number;
  }
> = {
  icon: {
    source: require('@/assets/images/mark.png'),
    aspectRatio: 1, // 4096 x 4096
    minWidth: 24,
    minHeight: 24,
    defaultWidth: 32,
    defaultHeight: 32,
  },
  horizontal: {
    source: require('@/assets/images/logo-horizontal.png'),
    aspectRatio: 3072 / 1114, // ~2.7576
    minWidth: 120,
    minHeight: Math.round(120 / (3072 / 1114)), // ~44px
    defaultWidth: 148,
    defaultHeight: Math.round(148 / (3072 / 1114)), // ~54px
  },
  stacked: {
    source: require('@/assets/images/logo-stacked.png'),
    aspectRatio: 2048 / 2405, // ~0.8516
    minWidth: 96,
    minHeight: Math.round(96 / (2048 / 2405)), // ~113px
    defaultWidth: 120,
    defaultHeight: Math.round(120 / (2048 / 2405)), // ~141px
  },
  primary: {
    source: require('@/assets/images/logo-primary.png'),
    aspectRatio: 4096 / 1959, // ~2.0909
    minWidth: 140,
    minHeight: Math.round(140 / (4096 / 1959)), // ~67px
    defaultWidth: 180,
    defaultHeight: Math.round(180 / (4096 / 1959)), // ~86px
  },
};

/**
 * BrandMark
 * The authoritative visual component for rendering Friday Amanah logos and marks.
 * Enforces brand clear-space and minimum-dimension rules in code.
 * Follows Rule 6 / ADR-015 and docs 09 & 17.
 */
export function BrandMark({
  variant = 'icon',
  width: propWidth,
  height: propHeight,
  accessibilityLabel = 'Friday Amanah',
  clearSpace = false,
  style,
  imageStyle,
}: BrandMarkProps) {
  const config = BRAND_CONSTRAINTS[variant];

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

  // Clear space: >= 25% of height per doc 09 §2.5
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
        source={config.source}
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
