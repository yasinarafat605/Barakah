import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Money } from '@/src/domain/money';
import {
  getAccountsWithBalances,
  createAccount,
  deleteAccount,
  archiveAccount,
  restoreArchivedAccount,
  AccountWithBalance,
  AccountType,
} from '@/src/db';

const ACCOUNT_TYPES: { type: AccountType; icon: keyof typeof Ionicons.glyphMap }[] = [
  { type: 'cash', icon: 'cash-outline' },
  { type: 'bank', icon: 'business-outline' },
  { type: 'mobile_wallet', icon: 'phone-portrait-outline' },
  { type: 'savings', icon: 'trending-up-outline' },
];

export default function AccountsScreen() {
  const { t, i18n } = useTranslation();
  const currentLocale = (i18n.language?.startsWith('bn') ? 'bn' : 'en') as 'en' | 'bn';
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Modal & form state
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<AccountType>('cash');
  const [formBalance, setFormBalance] = useState('');
  const [formErrors, setFormErrors] = useState<{ name?: string; balance?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await getAccountsWithBalances();
      setAccounts(data);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAccounts();
    }, [loadAccounts])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadAccounts();
  };

  const openAddAccountModal = () => {
    setFormName('');
    setFormType('cash');
    setFormBalance('');
    setFormErrors({});
    setIsModalVisible(true);
  };

  const handleSaveAccount = async () => {
    const trimmedName = formName.trim();
    const errors: { name?: string; balance?: string } = {};

    if (!trimmedName) {
      errors.name = t('accounts.errors.nameRequired');
    }

    const rawBalanceStr = formBalance.trim();
    let initialBalancePoisha = 0;

    if (rawBalanceStr !== '') {
      // Convert Bengali numerals to Latin if entered in Bengali
      const normalizedStr = rawBalanceStr.replace(/[০-৯]/g, (d) =>
        String('০১২৩৪৫৬৭৮৯'.indexOf(d))
      );
      const parsedTaka = parseFloat(normalizedStr);

      if (Number.isNaN(parsedTaka) || !Number.isFinite(parsedTaka) || parsedTaka < 0) {
        errors.balance = t('accounts.errors.invalidAmount');
      } else {
        // ADR-004: All monetary inputs are integer minor units (poisha)
        initialBalancePoisha = Math.round(parsedTaka * 100);
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await createAccount({
        name: trimmedName,
        type: formType,
        initialBalancePoisha,
        currency: 'BDT',
      });
      setIsModalVisible(false);
      await loadAccounts();
    } catch (err) {
      console.error('Failed to create account:', err);
      Alert.alert(t('status.error'), t('accounts.errors.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAccount = (account: AccountWithBalance) => {
    Alert.alert(
      t('accounts.deleteTitle'),
      t('accounts.deleteConfirm', { name: account.name }),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('actions.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount(account.id);
              await loadAccounts();
            } catch (err) {
              console.error('Failed to delete account:', err);
              // Foreign key rejection check (ON DELETE RESTRICT)
              Alert.alert(t('status.error'), t('accounts.deleteHasTransactions'));
            }
          },
        },
      ]
    );
  };

  const handleArchiveAccount = async (account: AccountWithBalance, confirmed = false) => {
    try {
      await archiveAccount(account.id, confirmed);
      await loadAccounts();
    } catch (err) {
      if (!confirmed && err instanceof Error && err.message.includes('FUNDED_GOAL_CONFIRMATION')) {
        Alert.alert(t('planning.fundedGoalsTitle'), t('planning.fundedGoalsArchivePrompt'), [
          { text: t('actions.cancel'), style: 'cancel' },
          { text: t('planning.archive'), style: 'destructive', onPress: () => handleArchiveAccount(account, true) },
        ]);
      } else Alert.alert(t('status.error'), err instanceof Error ? err.message : t('planning.archiveAccountFailed'));
    }
  };

  const visibleAccounts = useMemo(
    () => accounts.filter((account) => showArchived ? account.archived_at !== null : account.archived_at === null),
    [accounts, showArchived]
  );

  // Group totals by currency - never calculate a mixed-currency grand total without exchange-rate conversion
  const currencyTotals = useMemo(() => {
    const groups: { [currency: string]: Money } = {};
    for (const acc of accounts) {
      const curr = acc.currency || 'BDT';
      if (!groups[curr]) {
        groups[curr] = acc.balance;
      } else {
        groups[curr] = groups[curr].add(acc.balance);
      }
    }
    return Object.entries(groups).map(([currency, total]) => ({
      currency,
      total,
    }));
  }, [accounts]);

  const getAccountIcon = (type: AccountType): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'cash':
        return 'cash-outline';
      case 'bank':
        return 'business-outline';
      case 'mobile_wallet':
        return 'phone-portrait-outline';
      case 'savings':
        return 'trending-up-outline';
      default:
        return 'wallet-outline';
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.primary}
          />
        }>
        {/* Screen Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: theme.text }]}>
              {t('screens.accounts.title')}
            </Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              {t('screens.accounts.subtitle')}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.headerAddButton, { backgroundColor: theme.surfaceTinted }]}
            onPress={openAddAccountModal}
            accessibilityRole="button"
            accessibilityLabel={t('accounts.addAccount')}>
            <Ionicons name="add" size={24} color={theme.primary} />
          </TouchableOpacity>
        </View>

        {/* Total Net Balance Card */}
        <View
          style={[
            styles.totalCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}>
          <View style={styles.totalCardHeader}>
            <Text style={[styles.totalCardLabel, { color: theme.textMuted }]}>
              {currencyTotals.length > 1
                ? t('accounts.totalBalanceByCurrency')
                : t('accounts.totalBalance')}
            </Text>
            <View
              style={[
                styles.accountCountBadge,
                { backgroundColor: theme.surfaceTinted },
              ]}>
              <Text style={[styles.accountCountText, { color: theme.primary }]}>
                {accounts.length}
              </Text>
            </View>
          </View>
          {currencyTotals.length === 0 ? (
            <Text style={[styles.totalAmount, { color: theme.text }]}>
              {Money.zero('BDT').format(currentLocale)}
            </Text>
          ) : currencyTotals.length === 1 ? (
            <Text style={[styles.totalAmount, { color: theme.text }]}>
              {currencyTotals[0].total.format(currentLocale)}
            </Text>
          ) : (
            <View style={styles.multiCurrencyTotalsContainer}>
              {currencyTotals.map(({ currency, total }) => (
                <View key={currency} style={styles.multiCurrencyRow}>
                  <Text style={[styles.currencyLabel, { color: theme.textMuted }]}>
                    {currency}
                  </Text>
                  <Text style={[styles.multiCurrencyAmount, { color: theme.text }]}>
                    {total.format(currentLocale)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Accounts List / Empty State */}
        <TouchableOpacity onPress={() => setShowArchived((value) => !value)}>
          <Text style={{ color: theme.primary }}>{t(showArchived ? 'planning.showActiveAccounts' : 'planning.showArchivedAccounts')}</Text>
        </TouchableOpacity>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : visibleAccounts.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}>
            <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: theme.surfaceTinted },
              ]}>
              <Ionicons name="wallet-outline" size={36} color={theme.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {t('accounts.emptyTitle')}
            </Text>
            <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>
              {t('accounts.emptySubtitle')}
            </Text>
            <TouchableOpacity
              style={[styles.emptyAddButton, { backgroundColor: theme.primary }]}
              onPress={openAddAccountModal}
              accessibilityRole="button">
              <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
              <Text style={styles.emptyAddButtonText}>
                {t('accounts.addAccount')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {visibleAccounts.map((account) => (
              <View
                key={account.id}
                style={[
                  styles.accountCard,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}>
                <View style={styles.accountCardMain}>
                  <View
                    style={[
                      styles.accountIconBadge,
                      { backgroundColor: theme.surfaceTinted },
                    ]}>
                    <Ionicons
                      name={getAccountIcon(account.type)}
                      size={22}
                      color={theme.primary}
                    />
                  </View>

                  <View style={styles.accountDetails}>
                    <Text style={[styles.accountName, { color: theme.text }]}>
                      {account.name}
                    </Text>
                    <Text
                      style={[styles.accountTypeLabel, { color: theme.textMuted }]}>
                      {t(`accounts.types.${account.type}`)}
                    </Text>
                  </View>

                  <View style={styles.balanceContainer}>
                    <Text
                      style={[
                        styles.accountBalance,
                        {
                          color: account.balance.isNegative()
                            ? theme.error
                            : theme.text,
                        },
                      ]}>
                      {account.balance.format(currentLocale)}
                    </Text>
                    <Text
                      style={[
                        styles.transactionCountText,
                        { color: theme.textMuted },
                      ]}>
                      {t('accounts.transactionsCount', {
                        count: account.transaction_count,
                      })}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => account.archived_at === null ? handleArchiveAccount(account) : restoreArchivedAccount(account.id).then(loadAccounts)}
                    accessibilityRole="button"
                    accessibilityLabel={t(account.archived_at === null ? 'planning.archive' : 'planning.restore')}>
                    <Ionicons
                      name={account.archived_at === null ? 'archive-outline' : 'refresh-outline'}
                      size={18}
                      color={theme.textMuted}
                    />
                  </TouchableOpacity>
                  {account.transaction_count === 0 && account.archived_at === null && <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteAccount(account)} accessibilityRole="button" accessibilityLabel={t('actions.delete')}><Ionicons name="trash-outline" size={18} color={theme.textMuted}/></TouchableOpacity>}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Floating Action Button (FAB) */}
      {accounts.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: theme.primary }]}
          onPress={openAddAccountModal}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('accounts.addAccount')}>
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </TouchableOpacity>
      )}

      {/* Add Account Bottom Sheet / Modal */}
      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setIsModalVisible(false)}
          />
          <View
            style={[
              styles.modalContent,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                {t('accounts.createAccount')}
              </Text>
              <TouchableOpacity
                onPress={() => setIsModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel={t('actions.close')}>
                <Ionicons name="close" size={24} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.formContainer}>
              {/* Account Type Selector Chips */}
              <View style={styles.formGroup}>
                <Text style={[styles.inputLabel, { color: theme.text }]}>
                  {t('accounts.type')}
                </Text>
                <View style={styles.typeChipsGrid}>
                  {ACCOUNT_TYPES.map(({ type, icon }) => {
                    const isSelected = formType === type;
                    return (
                      <TouchableOpacity
                        key={type}
                        style={[
                          styles.typeChip,
                          {
                            backgroundColor: isSelected
                              ? theme.surfaceTinted
                              : theme.background,
                            borderColor: isSelected ? theme.primary : theme.border,
                          },
                        ]}
                        onPress={() => setFormType(type)}>
                        <Ionicons
                          name={icon}
                          size={18}
                          color={isSelected ? theme.primary : theme.textMuted}
                        />
                        <Text
                          style={[
                            styles.typeChipText,
                            {
                              color: isSelected ? theme.primary : theme.text,
                              fontWeight: isSelected ? '600' : '400',
                            },
                          ]}>
                          {t(`accounts.types.${type}`)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Account Name Input */}
              <View style={styles.formGroup}>
                <Text style={[styles.inputLabel, { color: theme.text }]}>
                  {t('accounts.name')}
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: theme.background,
                      color: theme.text,
                      borderColor: formErrors.name ? theme.error : theme.border,
                    },
                  ]}
                  placeholder={t('accounts.namePlaceholder')}
                  placeholderTextColor={theme.muted}
                  value={formName}
                  onChangeText={(text) => {
                    setFormName(text);
                    if (formErrors.name) {
                      setFormErrors((prev) => ({ ...prev, name: undefined }));
                    }
                  }}
                  autoFocus={true}
                />
                {formErrors.name && (
                  <Text style={[styles.errorText, { color: theme.error }]}>
                    {formErrors.name}
                  </Text>
                )}
              </View>

              {/* Initial Balance Input */}
              <View style={styles.formGroup}>
                <Text style={[styles.inputLabel, { color: theme.text }]}>
                  {t('accounts.initialBalance')}
                </Text>
                <View
                  style={[
                    styles.amountInputContainer,
                    {
                      backgroundColor: theme.background,
                      borderColor: formErrors.balance ? theme.error : theme.border,
                    },
                  ]}>
                  <Text style={[styles.currencyPrefix, { color: theme.primary }]}>
                    {t('currency.symbol')}
                  </Text>
                  <TextInput
                    style={[styles.amountInput, { color: theme.text }]}
                    placeholder={t('accounts.initialBalancePlaceholder')}
                    placeholderTextColor={theme.muted}
                    value={formBalance}
                    onChangeText={(text) => {
                      setFormBalance(text);
                      if (formErrors.balance) {
                        setFormErrors((prev) => ({ ...prev, balance: undefined }));
                      }
                    }}
                    keyboardType="decimal-pad"
                  />
                </View>
                {formErrors.balance && (
                  <Text style={[styles.errorText, { color: theme.error }]}>
                    {formErrors.balance}
                  </Text>
                )}
              </View>

              {/* Action Buttons */}
              <View style={styles.formActions}>
                <TouchableOpacity
                  style={[
                    styles.cancelButton,
                    { borderColor: theme.border, backgroundColor: theme.background },
                  ]}
                  onPress={() => setIsModalVisible(false)}
                  disabled={submitting}>
                  <Text style={[styles.cancelButtonText, { color: theme.text }]}>
                    {t('actions.cancel')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    { backgroundColor: theme.primary },
                    submitting && { opacity: 0.7 },
                  ]}
                  onPress={handleSaveAccount}
                  disabled={submitting}>
                  {submitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitButtonText}>
                      {t('actions.save')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    paddingBottom: 90,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  headerAddButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  totalCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  totalCardLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  accountCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  accountCountText: {
    fontSize: 12,
    fontWeight: '700',
  },
  totalAmount: {
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  multiCurrencyTotalsContainer: {
    gap: 8,
    marginTop: 4,
  },
  multiCurrencyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  currencyLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  multiCurrencyAmount: {
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyCard: {
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 10,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  emptyAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  emptyAddButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  listContainer: {
    gap: 12,
  },
  accountCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  accountCardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accountIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountDetails: {
    flex: 1,
    gap: 2,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '600',
  },
  accountTypeLabel: {
    fontSize: 12,
  },
  balanceContainer: {
    alignItems: 'flex-end',
    gap: 2,
  },
  accountBalance: {
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  transactionCountText: {
    fontSize: 11,
  },
  deleteButton: {
    padding: 6,
    marginLeft: 4,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DCE3EA',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  formContainer: {
    padding: 20,
    gap: 16,
  },
  formGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  typeChipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  typeChipText: {
    fontSize: 13,
  },
  textInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  currencyPrefix: {
    fontSize: 18,
    fontWeight: '700',
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  errorText: {
    fontSize: 12,
    marginTop: 2,
  },
  formActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  submitButton: {
    flex: 2,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
