import React, { useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Money } from '@/src/domain/money';
import {
  getTransactions,
  softDeleteTransaction,
  restoreTransaction,
  getCategoryDisplayName,
  TransactionWithDetails,
} from '@/src/db';

export default function TransactionsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === 'en' ? 'en' : 'bn';

  const [transactions, setTransactions] = useState<TransactionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Undo state for soft-deletion
  const [undoTx, setUndoTx] = useState<{ id: string; description: string } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTransactions = useCallback(async () => {
    try {
      const data = await getTransactions({ limit: 100 });
      setTransactions(data);
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTransactions();
    }, [loadTransactions])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadTransactions();
  };

  const handleDelete = (tx: TransactionWithDetails) => {
    const isTransfer = tx.type === 'transfer';
    Alert.alert(
      t('transactions.deleteConfirmTitle'),
      isTransfer
        ? t('transactions.deleteTransferMessage')
        : t('transactions.deleteConfirmMessage'),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('actions.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await softDeleteTransaction(tx.id);
              await loadTransactions();

              // Clear any existing undo timer
              if (undoTimeoutRef.current) {
                clearTimeout(undoTimeoutRef.current);
              }

              const desc = isTransfer
                ? `${tx.source_account_name || tx.account_name} → ${tx.destination_account_name || tx.related_account_name}`
                : tx.account_name;

              setUndoTx({ id: tx.id, description: desc });

              // Auto-dismiss undo banner after 6 seconds
              undoTimeoutRef.current = setTimeout(() => {
                setUndoTx(null);
              }, 6000);
            } catch (err) {
              console.error('Failed to delete transaction:', err);
              Alert.alert(t('status.error'), t('transactions.errors.deleteFailed'));
            }
          },
        },
      ]
    );
  };

  const handleUndo = async () => {
    if (!undoTx || isRestoring) return;
    setIsRestoring(true);
    try {
      await restoreTransaction(undoTx.id);
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
      setUndoTx(null);
      await loadTransactions();
    } catch (err) {
      console.error('Failed to restore transaction:', err);
      Alert.alert(t('status.error'), t('transactions.restoreFailed'));
    } finally {
      setIsRestoring(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    if (currentLocale === 'bn') {
      return date.toLocaleDateString('bn-BD', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }
    return date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const renderItem = ({ item }: { item: TransactionWithDetails }) => {
    const isIncome = item.type === 'income';
    const isExpense = item.type === 'expense';
    const isTransfer = item.type === 'transfer';

    let iconName: keyof typeof Ionicons.glyphMap = 'receipt-outline';
    let iconColor = theme.textMuted;
    let typeLabel = '';
    let sign = '';
    let amountColor = theme.text;
    let subtitle = '';

    if (isIncome) {
      iconName = 'arrow-down-circle';
      iconColor = theme.moneyIn;
      typeLabel = t('transactions.income');
      sign = '+';
      amountColor = theme.moneyIn;
      const catName = item.category_name_key
        ? getCategoryDisplayName(
            {
              id: item.category_id || '',
              name_key: item.category_name_key,
              name_custom: item.category_name_custom,
              type: 'income',
              icon: item.category_icon,
              color: null,
              is_archived: 0,
              sort_order: 0,
              is_default: 1,
              created_at: 0,
              updated_at: 0,
            },
            currentLocale,
            t
          )
        : '';
      subtitle = [catName, item.account_name].filter(Boolean).join(' • ');
    } else if (isExpense) {
      iconName = 'arrow-up-circle';
      iconColor = theme.moneyOut;
      typeLabel = t('transactions.expense');
      sign = '-';
      amountColor = theme.moneyOut;
      const catName = item.category_name_key
        ? getCategoryDisplayName(
            {
              id: item.category_id || '',
              name_key: item.category_name_key,
              name_custom: item.category_name_custom,
              type: 'expense',
              icon: item.category_icon,
              color: null,
              is_archived: 0,
              sort_order: 0,
              is_default: 1,
              created_at: 0,
              updated_at: 0,
            },
            currentLocale,
            t
          )
        : '';
      subtitle = [catName, item.account_name].filter(Boolean).join(' • ');
    } else if (isTransfer) {
      iconName = 'swap-horizontal';
      iconColor = theme.accent;
      typeLabel = t('transactions.transfer');
      sign = '';
      amountColor = theme.text;
      const srcName = item.source_account_name || item.account_name;
      const dstName = item.destination_account_name || item.related_account_name || '';
      subtitle = `${srcName} → ${dstName}`;
    }

    const moneyObj = new Money(item.amount, item.account_currency || 'BDT');

    return (
      <View
        style={[
          styles.txCard,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}>
        <View style={styles.txRow}>
          {/* Icon with colored badge background */}
          <View style={[styles.iconBadge, { backgroundColor: theme.surfaceTinted }]}>
            <Ionicons name={iconName} size={24} color={iconColor} />
          </View>

          {/* Details */}
          <View style={styles.txContent}>
            <View style={styles.txTopRow}>
              {/* Type pill for non-color-reliant visual distinction */}
              <View
                style={[
                  styles.typePill,
                  { borderColor: theme.border, backgroundColor: theme.surfaceTinted },
                ]}>
                <Text style={[styles.typePillText, { color: iconColor }]}>
                  {typeLabel}
                </Text>
              </View>
              <Text style={[styles.dateText, { color: theme.textMuted }]}>
                {formatDate(item.timestamp)}
              </Text>
            </View>

            <Text style={[styles.subtitleText, { color: theme.text }]} numberOfLines={1}>
              {subtitle}
            </Text>

            {item.note ? (
              <Text style={[styles.noteText, { color: theme.textMuted }]} numberOfLines={1}>
                {item.note}
              </Text>
            ) : null}
          </View>

          {/* Amount and delete button */}
          <View style={styles.amountContainer}>
            <Text
              style={[styles.amountText, { color: amountColor }]}
              numberOfLines={1}>
              {sign}
              {moneyObj.format(currentLocale)}
            </Text>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => handleDelete(item)}
              accessibilityLabel={t('actions.delete')}
              accessibilityRole="button">
              <Ionicons name="trash-outline" size={16} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.container}>
        {/* Header with Title and Add Button */}
        <View style={styles.header}>
          <View style={styles.headerTextContainer}>
            <Text style={[styles.title, { color: theme.text }]}>
              {t('screens.transactions.title')}
            </Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              {t('screens.transactions.subtitle')}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: theme.primary }]}
            onPress={() => router.push('/modal')}
            accessibilityLabel={t('transactions.addTransaction')}
            accessibilityRole="button">
            <Ionicons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.addButtonText}>{t('actions.add')}</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : (
          <FlatList
            data={transactions}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={[
              styles.listContent,
              transactions.length === 0 && styles.emptyListContent,
            ]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={theme.primary}
              />
            }
            ListEmptyComponent={
              <View
                style={[
                  styles.emptyCard,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}>
                <Ionicons name="receipt-outline" size={48} color={theme.textMuted} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  {t('transactions.noTransactions')}
                </Text>
                <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>
                  {t('transactions.noTransactionsSubtitle')}
                </Text>
                <TouchableOpacity
                  style={[styles.emptyAddButton, { backgroundColor: theme.primary }]}
                  onPress={() => router.push('/modal')}
                  accessibilityRole="button">
                  <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.emptyAddButtonText}>
                    {t('transactions.addTransaction')}
                  </Text>
                </TouchableOpacity>
              </View>
            }
          />
        )}

        {/* Accessible Floating Undo Banner */}
        {undoTx && (
          <View
            style={[
              styles.undoBanner,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}>
            <View style={styles.undoTextContainer}>
              <Ionicons name="checkmark-circle" size={20} color={theme.success} />
              <Text style={[styles.undoText, { color: theme.text }]} numberOfLines={1}>
                {t('transactions.deletedSuccess')}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.undoButton, { backgroundColor: theme.surfaceTinted }]}
              onPress={handleUndo}
              disabled={isRestoring}
              accessibilityRole="button"
              accessibilityLabel={t('transactions.undo')}>
              {isRestoring ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <>
                  <Ionicons name="arrow-undo" size={16} color={theme.primary} />
                  <Text style={[styles.undoButtonText, { color: theme.primary }]}>
                    {t('transactions.undo')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTextContainer: {
    gap: 4,
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txContent: {
    flex: 1,
    gap: 4,
  },
  txTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  dateText: {
    fontSize: 11,
  },
  subtitleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  noteText: {
    fontSize: 12,
  },
  amountContainer: {
    alignItems: 'flex-end',
    gap: 6,
  },
  amountText: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  deleteButton: {
    padding: 4,
  },
  emptyCard: {
    borderRadius: 16,
    padding: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 260,
  },
  emptyAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
    marginTop: 8,
  },
  emptyAddButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  undoBanner: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 999,
  },
  undoTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  undoText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  undoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  undoButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
