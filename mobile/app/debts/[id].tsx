import React, { useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Money } from '@/src/domain/money';
import {
  getDebtById,
  getDebtTimeline,
  softDeleteDebt,
  softDeleteRepayment,
  restoreRepayment,
  DebtWithDetails,
  DebtTransactionWithDetails,
} from '@/src/db';

export default function DebtDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === 'en' ? 'en' : 'bn';

  const [debt, setDebt] = useState<DebtWithDetails | null>(null);
  const [timeline, setTimeline] = useState<DebtTransactionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Undo banner state for repayment deletion
  const [undoRepaymentId, setUndoRepaymentId] = useState<string | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [d, tl] = await Promise.all([
        getDebtById(id),
        getDebtTimeline(id),
      ]);
      setDebt(d);
      setTimeline(tl);
    } catch (err) {
      console.error('Failed to load debt detail:', err);
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

  const handleDeleteDebt = () => {
    if (!debt) return;
    Alert.alert(
      t('debts.deleteConfirmTitle'),
      t('debts.deleteConfirmMessage'),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('actions.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await softDeleteDebt(debt.id);
              router.back();
            } catch (err: any) {
              console.error('Failed to delete debt:', err);
              Alert.alert(t('common.error'), err.message || t('debts.errors.cannotDeleteWithHistory'));
            }
          },
        },
      ]
    );
  };

  const handleDeleteRepayment = (item: DebtTransactionWithDetails) => {
    Alert.alert(
      t('transactions.deleteConfirmTitle'),
      'Are you sure you want to delete this repayment record? The outstanding debt balance will increase.',
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('actions.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await softDeleteRepayment(item.id);
              await loadData();

              if (undoTimeoutRef.current) {
                clearTimeout(undoTimeoutRef.current);
              }
              setUndoRepaymentId(item.id);
              undoTimeoutRef.current = setTimeout(() => {
                setUndoRepaymentId(null);
              }, 6000);
            } catch (err: any) {
              console.error('Failed to delete repayment:', err);
              Alert.alert(t('common.error'), err.message || 'Failed to delete repayment');
            }
          },
        },
      ]
    );
  };

  const handleUndoRepayment = async () => {
    if (!undoRepaymentId) return;
    try {
      await restoreRepayment(undoRepaymentId);
      setUndoRepaymentId(null);
      await loadData();
    } catch (err: any) {
      console.error('Failed to restore repayment:', err);
      Alert.alert(t('common.error'), err.message || 'Failed to restore repayment');
    }
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

  if (!debt) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View style={styles.centerContainer}>
          <Text style={[{ color: theme.text, fontSize: 16 }]}>{t('debts.noDebts')}</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={{ color: theme.primary, fontWeight: '600' }}>{t('actions.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isBorrowed = debt.direction === 'borrowed';
  const outstandingMoney = new Money(debt.outstanding_principal);
  const originalMoney = new Money(debt.original_principal);
  const repaidMoney = new Money(debt.total_repaid);

  // Repayment progress calculation (0 to 100%)
  const percentRepaid = debt.original_principal > 0
    ? Math.min(100, Math.round((debt.total_repaid / debt.original_principal) * 100))
    : 0;

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

        <Text style={[styles.headerTitle, { color: theme.text }]}>
          {isBorrowed ? t('debts.borrowed') : t('debts.lent')}
        </Text>

        <TouchableOpacity
          onPress={handleDeleteDebt}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t('actions.delete')}
        >
          <Ionicons name="trash-outline" size={22} color={theme.error} />
        </TouchableOpacity>
      </View>

      {/* Undo Banner */}
      {undoRepaymentId && (
        <View style={[styles.undoBanner, { backgroundColor: theme.surfaceTinted, borderColor: theme.primary }]}>
          <Text style={[styles.undoText, { color: theme.text }]}>
            {t('debts.repaymentDeleted')}
          </Text>
          <TouchableOpacity onPress={handleUndoRepayment} style={styles.undoButton}>
            <Text style={[styles.undoButtonText, { color: theme.primary }]}>{t('transactions.undo')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />}
      >
        {/* Counterparty Information Card */}
        <TouchableOpacity
          style={[styles.counterpartyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
          activeOpacity={0.7}
          onPress={() => router.push(`/counterparties/${debt.counterparty_id}` as any)}
        >
          <View style={styles.counterpartyLeft}>
            <View style={[styles.avatar, { backgroundColor: theme.surfaceTinted }]}>
              <Ionicons name="person" size={20} color={theme.primary} />
            </View>
            <View>
              <Text style={[styles.counterpartyName, { color: theme.text }]}>
                {debt.counterparty_name}
              </Text>
              <Text style={[styles.counterpartySubtitle, { color: theme.textMuted }]}>
                {t('debts.counterparty')} • {debt.counterparty_type}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>

        {/* Primary Outstanding Balance Card */}
        <View style={[styles.balanceCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.directionBadgeRow}>
            <View
              style={[
                styles.directionTag,
                { backgroundColor: isBorrowed ? '#FEE4E2' : theme.surfaceTinted },
              ]}
            >
              <Ionicons
                name={isBorrowed ? 'arrow-down-circle' : 'arrow-up-circle'}
                size={14}
                color={isBorrowed ? theme.moneyOut : theme.moneyIn}
              />
              <Text
                style={[
                  styles.directionTagText,
                  { color: isBorrowed ? theme.moneyOut : theme.moneyIn },
                ]}
              >
                {isBorrowed ? t('debts.iOwe') : t('debts.owedToMe')}
              </Text>
            </View>

            <View style={[styles.statusTag, { backgroundColor: theme.surfaceTinted }]}>
              <Text style={[styles.statusTagText, { color: theme.primary }]}>
                {t(`debts.${debt.status}`)}
              </Text>
            </View>
          </View>

          <Text style={[styles.outstandingLabel, { color: theme.textMuted }]}>
            {debt.status === 'settled' ? t('debts.settled') : t('debts.outstanding')}
          </Text>
          <Text
            style={[
              styles.outstandingValue,
              { color: isBorrowed ? theme.text : theme.primary },
            ]}
          >
            {outstandingMoney.format(currentLocale)}
          </Text>

          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressBarBg, { backgroundColor: theme.border }]}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    backgroundColor: theme.primary,
                    width: `${percentRepaid}%`,
                  },
                ]}
              />
            </View>
            <View style={styles.progressLabels}>
              <Text style={[styles.progressText, { color: theme.textMuted }]}>
                {t('debts.totalRepaid')}: {repaidMoney.format(currentLocale)} ({percentRepaid}%)
              </Text>
              <Text style={[styles.progressText, { color: theme.textMuted }]}>
                {originalMoney.format(currentLocale)}
              </Text>
            </View>
          </View>

          {/* Due date and details row */}
          <View style={[styles.detailsRow, { borderTopColor: theme.border }]}>
            <View style={styles.detailItem}>
              <Text style={[styles.detailItemLabel, { color: theme.textMuted }]}>
                {t('debts.openedDate')}
              </Text>
              <Text style={[styles.detailItemValue, { color: theme.text }]}>
                {new Date(debt.opened_at).toLocaleDateString(currentLocale === 'bn' ? 'bn-BD' : 'en-US')}
              </Text>
            </View>

            <View style={styles.detailItem}>
              <Text style={[styles.detailItemLabel, { color: theme.textMuted }]}>
                {t('debts.dueDate')}
              </Text>
              <Text style={[styles.detailItemValue, { color: debt.due_state === 'overdue' ? theme.error : theme.text }]}>
                {debt.due_date
                  ? new Date(debt.due_date.includes('T') ? debt.due_date : `${debt.due_date}T00:00:00`).toLocaleDateString(
                      currentLocale === 'bn' ? 'bn-BD' : 'en-US'
                    )
                  : t('debts.noDueDate')}
              </Text>
            </View>
          </View>

          {debt.note && (
            <View style={[styles.noteContainer, { backgroundColor: theme.background }]}>
              <Text style={[styles.noteText, { color: theme.textMuted }]}>
                {debt.note}
              </Text>
            </View>
          )}
        </View>

        {/* Primary Action Button (Record Repayment) */}
        {debt.status !== 'settled' && (
          <TouchableOpacity
            style={[styles.repayButton, { backgroundColor: theme.primary }]}
            onPress={() => router.push(`/debts/${debt.id}/repay` as any)}
            accessibilityRole="button"
            accessibilityLabel={t('debts.addRepayment')}
          >
            <Ionicons name="card-outline" size={20} color="#FFFFFF" />
            <Text style={styles.repayButtonText}>{t('debts.addRepayment')}</Text>
          </TouchableOpacity>
        )}

        {/* Timeline / Payment History */}
        <View style={styles.timelineSection}>
          <Text style={[styles.timelineSectionTitle, { color: theme.text }]}>
            {t('debts.timeline')} ({timeline.length})
          </Text>

          {timeline.length === 0 ? (
            <View style={[styles.emptyTimeline, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.emptyTimelineText, { color: theme.textMuted }]}>
                No repayments recorded yet.
              </Text>
            </View>
          ) : (
            timeline.map((item) => {
              const isRepay = item.role === 'repayment';
              return (
                <View
                  key={item.id}
                  style={[styles.timelineItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
                >
                  <View style={styles.timelineLeft}>
                    <View
                      style={[
                        styles.timelineIconBg,
                        { backgroundColor: isRepay ? theme.surfaceTinted : theme.background },
                      ]}
                    >
                      <Ionicons
                        name={isRepay ? 'checkmark-circle' : 'receipt'}
                        size={18}
                        color={isRepay ? theme.primary : theme.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.timelineRole, { color: theme.text }]}>
                        {isRepay ? t('debts.addRepayment') : item.role}
                      </Text>
                      <Text style={[styles.timelineMeta, { color: theme.textMuted }]}>
                        {item.occurred_at ? new Date(item.occurred_at).toLocaleDateString(currentLocale === 'bn' ? 'bn-BD' : 'en-US') : ''}
                        {item.account_name ? ` • ${item.account_name}` : ''}
                      </Text>
                      {item.note && (
                        <Text style={[styles.timelineNote, { color: theme.textMuted }]}>
                          {item.note}
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.timelineRight}>
                    <Text
                      style={[
                        styles.timelineAmount,
                        { color: isRepay ? theme.primary : theme.text },
                      ]}
                    >
                      {new Money(item.amount).format(currentLocale)}
                    </Text>

                    {isRepay && (
                      <TouchableOpacity
                        onPress={() => handleDeleteRepayment(item)}
                        style={styles.deleteRepayButton}
                        accessibilityLabel={t('actions.delete')}
                      >
                        <Ionicons name="trash-outline" size={16} color={theme.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  undoBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  undoText: {
    fontSize: 13,
    fontWeight: '500',
  },
  undoButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  undoButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },
  counterpartyCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  counterpartyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterpartyName: {
    fontSize: 15,
    fontWeight: '600',
  },
  counterpartySubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  balanceCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    gap: 14,
  },
  directionBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  directionTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  directionTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusTagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  outstandingLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  outstandingValue: {
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressContainer: {
    gap: 6,
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressText: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 12,
  },
  detailItem: {
    gap: 2,
  },
  detailItemLabel: {
    fontSize: 11,
  },
  detailItemValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  noteContainer: {
    padding: 10,
    borderRadius: 8,
  },
  noteText: {
    fontSize: 12,
    lineHeight: 16,
  },
  repayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  repayButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  timelineSection: {
    gap: 10,
  },
  timelineSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptyTimeline: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyTimelineText: {
    fontSize: 13,
  },
  timelineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  timelineLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    flex: 1,
  },
  timelineIconBg: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineRole: {
    fontSize: 13,
    fontWeight: '600',
  },
  timelineMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  timelineNote: {
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic',
  },
  timelineRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  timelineAmount: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  deleteRepayButton: {
    padding: 4,
  },
});
