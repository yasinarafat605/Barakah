import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Money } from '@/src/domain/money';
import {
  getDebts,
  getDebtSummary,
  DebtWithCounterparty,
  DebtSummary,
} from '@/src/db';

type FilterTab = 'all' | 'borrowed' | 'lent' | 'settled';

export default function DebtsDashboardScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === 'en' ? 'en' : 'bn';

  const [debts, setDebts] = useState<DebtWithCounterparty[]>([]);
  const [summary, setSummary] = useState<DebtSummary>({
    totalBorrowedByCurrency: {},
    totalLentByCurrency: {},
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [debtsList, debtSummary] = await Promise.all([
        getDebts({ isArchived: false }),
        getDebtSummary(),
      ]);
      setDebts(debtsList);
      setSummary(debtSummary);
    } catch (err) {
      console.error('Failed to load debts dashboard:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Filtered debts based on active tab and search query
  const filteredDebts = useMemo(() => {
    return debts.filter((d) => {
      // 1. Tab filter
      if (activeTab === 'borrowed' && (d.direction !== 'borrowed' || d.status === 'settled')) return false;
      if (activeTab === 'lent' && (d.direction !== 'lent' || d.status === 'settled')) return false;
      if (activeTab === 'settled' && d.status !== 'settled') return false;
      if (activeTab === 'all' && d.status === 'settled') {
        // In "all" tab, we still show active/overdue/due_soon debts primarily
        // but if user specifically chooses settled, they see settled.
      }

      // 2. Search query filter
      if (searchQuery.trim().length > 0) {
        const query = searchQuery.trim().toLowerCase();
        const matchesName = d.counterparty_name.toLowerCase().includes(query);
        const matchesNote = d.note ? d.note.toLowerCase().includes(query) : false;
        if (!matchesName && !matchesNote) return false;
      }

      return true;
    });
  }, [debts, activeTab, searchQuery]);

  // Render Status Badge helper
  const renderStatusBadge = (d: DebtWithCounterparty) => {
    switch (d.due_state) {
      case 'settled':
        return (
          <View style={[styles.badge, { backgroundColor: theme.surfaceTinted }]}>
            <Ionicons name="checkmark-circle" size={12} color={theme.success} />
            <Text style={[styles.badgeText, { color: theme.success }]}>{t('debts.settled')}</Text>
          </View>
        );
      case 'overdue':
        return (
          <View style={[styles.badge, { backgroundColor: '#FEE4E2' }]}>
            <Ionicons name="alert-circle" size={12} color={theme.error} />
            <Text style={[styles.badgeText, { color: theme.error }]}>{t('debts.overdue')}</Text>
          </View>
        );
      case 'due_soon':
        return (
          <View style={[styles.badge, { backgroundColor: '#FEF0C7' }]}>
            <Ionicons name="time" size={12} color={theme.accent} />
            <Text style={[styles.badgeText, { color: '#B54708' }]}>{t('debts.dueSoon')}</Text>
          </View>
        );
      default:
        return (
          <View style={[styles.badge, { backgroundColor: theme.surfaceTinted }]}>
            <Ionicons name="ellipse" size={8} color={theme.primary} />
            <Text style={[styles.badgeText, { color: theme.primary }]}>{t('debts.active')}</Text>
          </View>
        );
    }
  };

  const renderItem = ({ item }: { item: DebtWithCounterparty }) => {
    const isBorrowed = item.direction === 'borrowed';
    const outstandingMoney = new Money(item.outstanding_principal);
    const originalMoney = new Money(item.original_principal);

    return (
      <TouchableOpacity
        style={[styles.debtCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
        activeOpacity={0.7}
        onPress={() => router.push(`/debts/${item.id}` as any)}
        accessibilityRole="button"
        accessibilityLabel={`${isBorrowed ? t('debts.borrowed') : t('debts.lent')}: ${item.counterparty_name}, ${outstandingMoney.format(currentLocale)}`}
      >
        <View style={styles.cardTopRow}>
          <View style={styles.counterpartyInfo}>
            <Text style={[styles.counterpartyName, { color: theme.text }]} numberOfLines={1}>
              {item.counterparty_name}
            </Text>
            <View style={styles.directionRow}>
              <Ionicons
                name={isBorrowed ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                size={14}
                color={isBorrowed ? theme.moneyOut : theme.moneyIn}
              />
              <Text
                style={[
                  styles.directionLabel,
                  { color: isBorrowed ? theme.moneyOut : theme.moneyIn },
                ]}
              >
                {isBorrowed ? t('debts.borrowed') : t('debts.lent')}
              </Text>
            </View>
          </View>
          {renderStatusBadge(item)}
        </View>

        <View style={styles.cardBottomRow}>
          <View>
            <Text style={[styles.amountLabel, { color: theme.textMuted }]}>
              {item.status === 'settled' ? t('debts.originalPrincipal') : t('debts.outstanding')}
            </Text>
            <Text
              style={[
                styles.amountValue,
                { color: isBorrowed ? theme.text : theme.primary },
              ]}
            >
              {outstandingMoney.format(currentLocale)}
            </Text>
          </View>

          {item.status !== 'settled' && item.total_repaid > 0 && (
            <View style={styles.repaidInfo}>
              <Text style={[styles.repaidLabel, { color: theme.textMuted }]}>
                {t('debts.totalRepaid')}
              </Text>
              <Text style={[styles.repaidValue, { color: theme.textMuted }]}>
                {new Money(item.total_repaid).format(currentLocale)} / {originalMoney.format(currentLocale)}
              </Text>
            </View>
          )}

          {item.due_date && item.status !== 'settled' && (
            <View style={styles.dueDateBadge}>
              <Ionicons name="calendar-outline" size={12} color={theme.textMuted} />
              <Text style={[styles.dueDateText, { color: theme.textMuted }]}>
                {new Date(item.due_date).toLocaleDateString(currentLocale === 'bn' ? 'bn-BD' : 'en-US')}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityLabel={t('actions.cancel')}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>
          <View>
            <Text style={[styles.title, { color: theme.text }]}>{t('debts.title')}</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>{t('debts.subtitle')}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.peopleButton, { backgroundColor: theme.surfaceTinted }]}
          onPress={() => router.push('/counterparties' as any)}
          accessibilityRole="button"
          accessibilityLabel={t('counterparties.title')}
        >
          <Ionicons name="people-outline" size={20} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {/* Currency-Grouped Balance Summary Cards */}
      <View style={styles.summaryContainer}>
        {/* I Owe Card */}
        <View style={[styles.summaryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.summaryCardHeader}>
            <Ionicons name="arrow-down-circle" size={16} color={theme.moneyOut} />
            <Text style={[styles.summaryCardTitle, { color: theme.textMuted }]}>
              {t('debts.iOwe')}
            </Text>
          </View>
          {Object.keys(summary.totalBorrowedByCurrency).length === 0 ? (
            <Text style={[styles.summaryCardAmount, { color: theme.text }]}>
              {new Money(0).format(currentLocale)}
            </Text>
          ) : (
            Object.entries(summary.totalBorrowedByCurrency).map(([curr, amount]) => (
              <Text key={curr} style={[styles.summaryCardAmount, { color: theme.text }]}>
                {new Money(amount, curr).format(currentLocale)}
              </Text>
            ))
          )}
        </View>

        {/* Owed to Me Card */}
        <View style={[styles.summaryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.summaryCardHeader}>
            <Ionicons name="arrow-up-circle" size={16} color={theme.moneyIn} />
            <Text style={[styles.summaryCardTitle, { color: theme.textMuted }]}>
              {t('debts.owedToMe')}
            </Text>
          </View>
          {Object.keys(summary.totalLentByCurrency).length === 0 ? (
            <Text style={[styles.summaryCardAmount, { color: theme.primary }]}>
              {new Money(0).format(currentLocale)}
            </Text>
          ) : (
            Object.entries(summary.totalLentByCurrency).map(([curr, amount]) => (
              <Text key={curr} style={[styles.summaryCardAmount, { color: theme.primary }]}>
                {new Money(amount, curr).format(currentLocale)}
              </Text>
            ))
          )}
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={[styles.tabsContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'all' && [styles.activeTab, { backgroundColor: theme.surfaceTinted }]]}
          onPress={() => setActiveTab('all')}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'all' ? theme.primary : theme.textMuted },
            ]}
          >
            {t('debts.filterAll')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'borrowed' && [styles.activeTab, { backgroundColor: theme.surfaceTinted }]]}
          onPress={() => setActiveTab('borrowed')}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'borrowed' ? theme.primary : theme.textMuted },
            ]}
          >
            {t('debts.filterBorrowed')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'lent' && [styles.activeTab, { backgroundColor: theme.surfaceTinted }]]}
          onPress={() => setActiveTab('lent')}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'lent' ? theme.primary : theme.textMuted },
            ]}
          >
            {t('debts.filterLent')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'settled' && [styles.activeTab, { backgroundColor: theme.surfaceTinted }]]}
          onPress={() => setActiveTab('settled')}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'settled' ? theme.primary : theme.textMuted },
            ]}
          >
            {t('debts.filterSettled')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={[styles.searchBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="search" size={16} color={theme.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder={t('actions.search') || 'Search debts or counterparties...'}
          placeholderTextColor={theme.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={16} color={theme.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Debts List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredDebts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, filteredDebts.length === 0 && styles.emptyListContent]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconBg, { backgroundColor: theme.surfaceTinted }]}>
                <Ionicons name="document-text-outline" size={36} color={theme.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>{t('debts.noDebts')}</Text>
              <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>{t('debts.noDebtsSubtitle')}</Text>
            </View>
          }
        />
      )}

      {/* Floating Add Debt Button */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.primary }]}
        onPress={() => router.push('/debts/add' as any)}
        accessibilityRole="button"
        accessibilityLabel={t('debts.addDebt')}
      >
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  peopleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryContainer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  summaryCard: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  summaryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryCardTitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  summaryCardAmount: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    padding: 4,
    marginBottom: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTab: {},
  tabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 80,
    gap: 10,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  debtCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  counterpartyInfo: {
    flex: 1,
    marginRight: 10,
    gap: 4,
  },
  counterpartyName: {
    fontSize: 15,
    fontWeight: '600',
  },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  directionLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  amountLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  amountValue: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  repaidInfo: {
    alignItems: 'flex-end',
  },
  repaidLabel: {
    fontSize: 10,
    marginBottom: 2,
  },
  repaidValue: {
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  dueDateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dueDateText: {
    fontSize: 11,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIconBg: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
