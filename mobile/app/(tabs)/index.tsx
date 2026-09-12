import React from 'react';
import { StyleSheet, View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Money } from '@/src/domain/money';
import { BrandMark } from '@/src/components/BrandMark';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === 'en' ? 'en' : 'bn';

  // Sample initial balance for dashboard preview using integer minor units (ADR-004)
  const sampleBalance = new Money(125050); // 1,250.50 BDT

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header with Official Brand Identity */}
        <View style={styles.header}>
          <View style={styles.brandTitleContainer}>
            <BrandMark
              variant="horizontal"
              height={36}
              reverse={colorScheme === 'dark'}
              accessibilityLabel={t('app.name')}
            />
            <Text style={[styles.tagline, { color: theme.textMuted }]}>{t('app.tagline')}</Text>
          </View>
          <View style={[styles.brandBadge, { backgroundColor: theme.surfaceTinted }]}>
            <BrandMark
              variant="icon"
              height={26}
              reverse={colorScheme === 'dark'}
              accessibilityLabel={t('app.name')}
            />
          </View>
        </View>

        {/* Total Balance Card */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: theme.textMuted }]}>{t('screens.home.subtitle')}</Text>
            <Ionicons name="eye-outline" size={18} color={theme.textMuted} />
          </View>
          <Text style={[styles.balanceAmount, { color: theme.text }]}>
            {sampleBalance.format(currentLocale)}
          </Text>
        </View>

        {/* Quick Summary Grid */}
        <View style={styles.grid}>
          <View style={[styles.gridItem, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="arrow-down-circle" size={22} color={theme.moneyIn} />
            <Text style={[styles.gridLabel, { color: theme.textMuted }]}>{t('nav.transactions')}</Text>
            <Text style={[styles.gridValue, { color: theme.text }]}>
              {new Money(0).format(currentLocale)}
            </Text>
          </View>

          <View style={[styles.gridItem, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="wallet-outline" size={22} color={theme.primary} />
            <Text style={[styles.gridLabel, { color: theme.textMuted }]}>{t('nav.accounts')}</Text>
            <Text style={[styles.gridValue, { color: theme.text }]}>
              {new Money(0).format(currentLocale)}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    padding: 20,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  brandTitleContainer: {
    alignItems: 'flex-start',
  },
  tagline: {
    fontSize: 13,
    marginTop: 4,
  },
  brandBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
  gridItem: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  gridLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  gridValue: {
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
