import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Money } from '@/src/domain/money';
import {
  getCounterpartyById,
  getDebts,
  archiveCounterparty,
  restoreCounterparty,
  deleteCounterparty,
  CounterpartyWithDebtSummary,
  DebtWithDetails,
} from '@/src/db';

type DebtFilter = 'active' | 'settled';

export default function CounterpartyProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === 'en' ? 'en' : 'bn';

  const [counterparty, setCounterparty] = useState<CounterpartyWithDebtSummary | null>(null);
  const [debts, setDebts] = useState<DebtWithDetails[]>([]);
  const [activeFilter, setActiveFilter] = useState<DebtFilter>('active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [cp, debtList] = await Promise.all([
        getCounterpartyById(id),
        getDebts({ counterpartyId: id }),
      ]);
      setCounterparty(cp);
      setDebts(debtList);
    } catch (err) {
      console.error('Failed to load counterparty profile:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const filteredDebts = useMemo(() => {
    return debts.filter((d) => {
      if (activeFilter === 'active') return d.status !== 'settled';
      if (activeFilter === 'settled') return d.status === 'settled';
      return true;
    });
  }, [debts, activeFilter]);

  const handleToggleArchive = async () => {
    if (!counterparty) return;
    try {
      if (counterparty.is_archived) {
        await restoreCounterparty(counterparty.id);
      } else {
        await archiveCounterparty(counterparty.id);
      }
      await loadData();
    } catch (err: any) {
      console.error('Failed to toggle counterparty archive status:', err);
      Alert.alert(t('common.error'), err.message || 'Action failed');
    }
  };

  const handleDelete = () => {
    if (!counterparty) return;
    Alert.alert(
      t('counterparties.deleteConfirmTitle'),
      t('counterparties.deleteConfirmMessage', { name: counterparty.name }),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('actions.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCounterparty(counterparty.id);
              router.back();
            } catch (err: any) {
              console.error('Failed to delete counterparty:', err);
              Alert.alert(
                t('common.error'),
                err.message || t('counterparties.errors.cannotDeleteWithDebts')
              );
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!counterparty) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View style={styles.centerContainer}>
          <Text style={{ color: theme.text }}>Counterparty not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={{ color: theme.primary }}>{t('actions.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const initials = counterparty.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t('actions.cancel')}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleToggleArchive}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={counterparty.is_archived ? t('counterparties.restore') : t('counterparties.archive')}
          >
            <Ionicons
              name={counterparty.is_archived ? 'archive' : 'archive-outline'}
              size={22}
              color={theme.textMuted}
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDelete}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={t('actions.delete')}
          >
            <Ionicons name="trash-outline" size={22} color={theme.error} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />}
      >
        {/* Profile Card */}
        <View style={[styles.profileCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.avatar, { backgroundColor: theme.surfaceTinted }]}>
            <Text style={[styles.avatarText, { color: theme.primary }]}>{initials}</Text>
          </View>
          <Text style={[styles.profileName, { color: theme.text }]}>{counterparty.name}</Text>
          <View style={[styles.typeBadge, { backgroundColor: theme.surfaceTinted }]}>
            <Text style={[styles.typeBadgeText, { color: theme.primary }]}>
              {t(`counterparties.types.${counterparty.type}`)}
            </Text>
          </View>

          {/* Contact Details */}
          {(counterparty.phone || counterparty.email) && (
            <View style={[styles.contactBox, { borderTopColor: theme.border }]}>
              {counterparty.phone && (
                <TouchableOpacity
                  style={styles.contactItem}
                  onPress={() => Linking.openURL(`tel:${counterparty.phone}`)}
                >
                  <Ionicons name="call-outline" size={16} color={theme.primary} />
                  <Text style={[styles.contactText, { color: theme.primary }]}>
                    {counterparty.phone}
                  </Text>
                </TouchableOpacity>
              )}
              {counterparty.email && (
                <TouchableOpacity
                  style={styles.contactItem}
                  onPress={() => Linking.openURL(`mailto:${counterparty.email}`)}
                >
                  <Ionicons name="mail-outline" size={16} color={theme.primary} />
                  <Text style={[styles.contactText, { color: theme.primary }]}>
                    {counterparty.email}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {counterparty.note && (
            <View style={[styles.noteBox, { backgroundColor: theme.background }]}>
              <Text style={[styles.noteText, { color: theme.textMuted }]}>
                {counterparty.note}
              </Text>
            </View>
          )}
        </View>

        {/* Currency-Grouped Balance Summary */}
        <View style={styles.summaryContainer}>
          <View style={[styles.summaryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.summaryCardHeader}>
              <Ionicons name="arrow-down-circle" size={16} color={theme.moneyOut} />
              <Text style={[styles.summaryCardTitle, { color: theme.textMuted }]}>
                {t('debts.iOwe')}
              </Text>
            </View>
            {Object.keys(counterparty.total_borrowed_by_currency).length === 0 ? (
              <Text style={[styles.summaryCardAmount, { color: theme.text }]}>
                {new Money(0).format(currentLocale)}
              </Text>
            ) : (
              Object.entries(counterparty.total_borrowed_by_currency).map(([curr, amt]) => (
                <Text key={curr} style={[styles.summaryCardAmount, { color: theme.text }]}>
                  {new Money(Number(amt)).format(currentLocale)}
                </Text>
              ))
            )}
          </View>

          <View style={[styles.summaryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.summaryCardHeader}>
              <Ionicons name="arrow-up-circle" size={16} color={theme.moneyIn} />
              <Text style={[styles.summaryCardTitle, { color: theme.textMuted }]}>
                {t('debts.owedToMe')}
              </Text>
            </View>
            {Object.keys(counterparty.total_lent_by_currency).length === 0 ? (
              <Text style={[styles.summaryCardAmount, { color: theme.primary }]}>
                {new Money(0).format(currentLocale)}
              </Text>
            ) : (
              Object.entries(counterparty.total_lent_by_currency).map(([curr, amt]) => (
                <Text key={curr} style={[styles.summaryCardAmount, { color: theme.primary }]}>
                  {new Money(Number(amt)).format(currentLocale)}
                </Text>
              ))
            )}
          </View>
        </View>

        {/* Quick Add Debt Action */}
        <TouchableOpacity
          style={[styles.addDebtButton, { backgroundColor: theme.primary }]}
          onPress={() => router.push(`/debts/add?counterpartyId=${counterparty.id}` as any)}
          accessibilityRole="button"
        >
          <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
          <Text style={styles.addDebtButtonText}>
            {t('debts.addDebt')}
          </Text>
        </TouchableOpacity>

        {/* Debts Tab Filter */}
        <View style={[styles.tabsContainer, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <TouchableOpacity
            style={[styles.tab, activeFilter === 'active' && [styles.activeTab, { backgroundColor: theme.surfaceTinted }]]}
            onPress={() => setActiveFilter('active')}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeFilter === 'active' ? theme.primary : theme.textMuted },
              ]}
            >
              {t('debts.active')} ({counterparty.active_debt_count})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeFilter === 'settled' && [styles.activeTab, { backgroundColor: theme.surfaceTinted }]]}
            onPress={() => setActiveFilter('settled')}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeFilter === 'settled' ? theme.primary : theme.textMuted },
              ]}
            >
              {t('debts.settled')} ({counterparty.settled_debt_count})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Debts List */}
        <View style={styles.debtsList}>
          {filteredDebts.length === 0 ? (
            <View style={[styles.emptyDebtsCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.emptyDebtsText, { color: theme.textMuted }]}>
                No {activeFilter} debts with {counterparty.name}.
              </Text>
            </View>
          ) : (
            filteredDebts.map((item) => {
              const isBorrowed = item.direction === 'borrowed';
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.debtItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/debts/${item.id}` as any)}
                >
                  <View style={styles.debtItemLeft}>
                    <Ionicons
                      name={isBorrowed ? 'arrow-down-circle' : 'arrow-up-circle'}
                      size={20}
                      color={isBorrowed ? theme.moneyOut : theme.moneyIn}
                    />
                    <View>
                      <Text style={[styles.debtDirection, { color: isBorrowed ? theme.moneyOut : theme.moneyIn }]}>
                        {isBorrowed ? t('debts.borrowed') : t('debts.lent')}
                      </Text>
                      <Text style={[styles.debtDate, { color: theme.textMuted }]}>
                        {new Date(item.opened_at).toLocaleDateString(currentLocale === 'bn' ? 'bn-BD' : 'en-US')}
                        {item.due_date ? ` • Due: ${new Date(item.due_date).toLocaleDateString(currentLocale === 'bn' ? 'bn-BD' : 'en-US')}` : ''}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.debtItemRight}>
                    <Text
                      style={[
                        styles.debtAmount,
                        { color: isBorrowed ? theme.text : theme.primary },
                      ]}
                    >
                      {new Money(item.outstanding_principal).format(currentLocale)}
                    </Text>
                    <Text style={[styles.debtOriginal, { color: theme.textMuted }]}>
                      / {new Money(item.original_principal).format(currentLocale)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
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
    paddingVertical: 12,
  },
  headerButton: {
    padding: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },
  profileCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  contactBox: {
    width: '100%',
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  contactText: {
    fontSize: 13,
    fontWeight: '500',
  },
  noteBox: {
    width: '100%',
    padding: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  noteText: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  summaryContainer: {
    flexDirection: 'row',
    gap: 12,
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
  addDebtButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  addDebtButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTab: {},
  tabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  debtsList: {
    gap: 10,
  },
  emptyDebtsCard: {
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyDebtsText: {
    fontSize: 13,
  },
  debtItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  debtItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  debtDirection: {
    fontSize: 13,
    fontWeight: '600',
  },
  debtDate: {
    fontSize: 11,
    marginTop: 2,
  },
  debtItemRight: {
    alignItems: 'flex-end',
  },
  debtAmount: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  debtOriginal: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
});
