import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Money, parseMoneyInput } from '@/src/domain/money';
import {
  getAccountsWithBalances,
  getCategories,
  createIncomeTransaction,
  createExpenseTransaction,
  createTransfer,
  getCategoryDisplayName,
  AccountWithBalance,
  CategoryRow,
  TransactionType,
} from '@/src/db';

export default function AddTransactionModal() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === 'en' ? 'en' : 'bn';

  // Transaction form state
  const [type, setType] = useState<TransactionType>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [sourceAccountId, setSourceAccountId] = useState<string>('');
  const [destinationAccountId, setDestinationAccountId] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [note, setNote] = useState('');
  const [timestamp] = useState<number>(Date.now());

  // Data state
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Load accounts and categories
  useEffect(() => {
    let isMounted = true;
    async function loadFormData() {
      try {
        setLoadingData(true);
        const [accList, catList] = await Promise.all([
          getAccountsWithBalances(),
          getCategories({ isArchived: false }),
        ]);

        if (!isMounted) return;

        setAccounts(accList);
        setCategories(catList);

        if (accList.length > 0) {
          setSelectedAccountId(accList[0].id);
          setSourceAccountId(accList[0].id);
          if (accList.length > 1) {
            setDestinationAccountId(accList[1].id);
          } else {
            setDestinationAccountId(accList[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load transaction form data:', err);
      } finally {
        if (isMounted) setLoadingData(false);
      }
    }
    loadFormData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter categories by type (income vs expense)
  const availableCategories = useMemo(() => {
    if (type === 'transfer') return [];
    return categories.filter((c) => c.type === type);
  }, [categories, type]);

  // Default category selection when type changes or categories load
  useEffect(() => {
    if (type !== 'transfer' && availableCategories.length > 0) {
      // If current selection is not in available categories, reset to first
      if (!availableCategories.some((c) => c.id === selectedCategoryId)) {
        setSelectedCategoryId(availableCategories[0].id);
      }
    }
  }, [type, availableCategories, selectedCategoryId]);

  // Selected accounts lookup
  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  );
  const sourceAccount = useMemo(
    () => accounts.find((a) => a.id === sourceAccountId),
    [accounts, sourceAccountId]
  );
  const destAccount = useMemo(
    () => accounts.find((a) => a.id === destinationAccountId),
    [accounts, destinationAccountId]
  );

  // Live amount parsing & preview
  const parsedAmount = useMemo<number | null>(() => {
    const trimmed = amountStr.trim();
    if (!trimmed) return null;
    const res = parseMoneyInput(trimmed, 2);
    return res.valid ? res.amountMinor : null;
  }, [amountStr]);

  // Dirty state tracking for discard warning
  const isDirty = useMemo(() => {
    return amountStr.trim().length > 0 || note.trim().length > 0;
  }, [amountStr, note]);

  // Discard check on close
  const handleClose = useCallback(() => {
    if (isDirty) {
      Alert.alert(
        t('actions.cancel'),
        currentLocale === 'bn'
          ? 'আপনার পরিবর্তনগুলো বাতিল করতে চান?'
          : 'Are you sure you want to discard your changes?',
        [
          { text: t('actions.cancel'), style: 'cancel' },
          {
            text: currentLocale === 'bn' ? 'বাতিল করুন' : 'Discard',
            style: 'destructive',
            onPress: () => router.back(),
          },
        ]
      );
    } else {
      router.back();
    }
  }, [isDirty, router, currentLocale, t]);

  // Submission handler
  const handleSave = async () => {
    if (isSubmitting) return;

    setValidationError(null);

    // 1. Amount validation
    if (!amountStr.trim()) {
      setValidationError(t('transactions.errors.amountRequired'));
      return;
    }
    if (parsedAmount === null || parsedAmount <= 0) {
      setValidationError(t('transactions.errors.invalidAmount'));
      return;
    }

    // 2. Account validation
    if (type === 'transfer') {
      if (!sourceAccountId || !destinationAccountId) {
        setValidationError(t('transactions.errors.accountRequired'));
        return;
      }
      if (sourceAccountId === destinationAccountId) {
        setValidationError(t('transactions.errors.sameAccountTransfer'));
        return;
      }
      if (!sourceAccount || !destAccount) {
        setValidationError(t('transactions.errors.accountRequired'));
        return;
      }
      if (sourceAccount.currency !== destAccount.currency) {
        setValidationError(
          t('transactions.errors.crossCurrencyTransfer', {
            source: sourceAccount.currency,
            destination: destAccount.currency,
          })
        );
        return;
      }
    } else {
      if (!selectedAccountId) {
        setValidationError(t('transactions.errors.accountRequired'));
        return;
      }
      if (!selectedCategoryId) {
        setValidationError(t('transactions.errors.categoryRequired'));
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (type === 'income') {
        await createIncomeTransaction({
          accountId: selectedAccountId,
          categoryId: selectedCategoryId,
          amountMinor: parsedAmount,
          occurredAt: timestamp,
          note: note.trim() || undefined,
        });
      } else if (type === 'expense') {
        await createExpenseTransaction({
          accountId: selectedAccountId,
          categoryId: selectedCategoryId,
          amountMinor: parsedAmount,
          occurredAt: timestamp,
          note: note.trim() || undefined,
        });
      } else if (type === 'transfer') {
        await createTransfer({
          sourceAccountId,
          destinationAccountId,
          amountMinor: parsedAmount,
          occurredAt: timestamp,
          note: note.trim() || undefined,
        });
      }

      router.back();
    } catch (err: any) {
      console.error('Failed to create transaction:', err);
      Alert.alert(t('status.error'), err?.message || t('transactions.errors.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleClose}
            accessibilityLabel={t('actions.cancel')}
            accessibilityRole="button">
            <Ionicons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {t('transactions.recordTransaction')}
          </Text>
          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: theme.primary },
              isSubmitting && { opacity: 0.7 },
            ]}
            onPress={handleSave}
            disabled={isSubmitting}
            accessibilityLabel={t('actions.save')}
            accessibilityRole="button">
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>{t('actions.save')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {loadingData ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : accounts.length === 0 ? (
          <View style={styles.centerContainer}>
            <Ionicons name="wallet-outline" size={48} color={theme.textMuted} />
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>
              {t('transactions.errors.noAccounts')}
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: theme.primary }]}
              onPress={() => {
                router.back();
                router.push('/(tabs)/accounts');
              }}>
              <Text style={styles.primaryButtonText}>{t('accounts.addAccount')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled">
            {/* Type Selector (Income / Expense / Transfer) */}
            <View style={[styles.typeSelector, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <TouchableOpacity
                style={[
                  styles.typeTab,
                  type === 'expense' && { backgroundColor: theme.surfaceTinted },
                ]}
                onPress={() => {
                  setType('expense');
                  setValidationError(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: type === 'expense' }}>
                <Ionicons
                  name="arrow-up-circle"
                  size={18}
                  color={type === 'expense' ? theme.moneyOut : theme.textMuted}
                />
                <Text
                  style={[
                    styles.typeTabText,
                    { color: type === 'expense' ? theme.moneyOut : theme.textMuted },
                    type === 'expense' && styles.typeTabTextActive,
                  ]}>
                  {t('transactions.expense')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typeTab,
                  type === 'income' && { backgroundColor: theme.surfaceTinted },
                ]}
                onPress={() => {
                  setType('income');
                  setValidationError(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: type === 'income' }}>
                <Ionicons
                  name="arrow-down-circle"
                  size={18}
                  color={type === 'income' ? theme.moneyIn : theme.textMuted}
                />
                <Text
                  style={[
                    styles.typeTabText,
                    { color: type === 'income' ? theme.moneyIn : theme.textMuted },
                    type === 'income' && styles.typeTabTextActive,
                  ]}>
                  {t('transactions.income')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typeTab,
                  type === 'transfer' && { backgroundColor: theme.surfaceTinted },
                ]}
                onPress={() => {
                  setType('transfer');
                  setValidationError(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: type === 'transfer' }}>
                <Ionicons
                  name="swap-horizontal"
                  size={18}
                  color={type === 'transfer' ? theme.accent : theme.textMuted}
                />
                <Text
                  style={[
                    styles.typeTabText,
                    { color: type === 'transfer' ? theme.accent : theme.textMuted },
                    type === 'transfer' && styles.typeTabTextActive,
                  ]}>
                  {t('transactions.transfer')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Validation Error Banner */}
            {validationError && (
              <View style={[styles.errorBanner, { backgroundColor: theme.surface, borderColor: theme.error }]}>
                <Ionicons name="alert-circle" size={18} color={theme.error} />
                <Text style={[styles.errorBannerText, { color: theme.error }]}>
                  {validationError}
                </Text>
              </View>
            )}

            {/* Amount Input & Live Preview */}
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.label, { color: theme.textMuted }]}>
                {t('transactions.amount')} ({currentAccount?.currency || 'BDT'})
              </Text>
              <View style={styles.amountInputRow}>
                <Text style={[styles.currencySymbol, { color: theme.textMuted }]}>
                  {currentAccount?.currency === 'BDT' ? '৳' : currentAccount?.currency || '৳'}
                </Text>
                <TextInput
                  style={[styles.amountInput, { color: theme.text }]}
                  placeholder="0.00"
                  placeholderTextColor={theme.muted}
                  keyboardType="numeric"
                  value={amountStr}
                  onChangeText={(text) => {
                    setAmountStr(text);
                    setValidationError(null);
                  }}
                  autoFocus
                  accessibilityLabel={t('transactions.amount')}
                />
              </View>

              {/* Formatted Preview */}
              {parsedAmount !== null && (
                <View style={styles.previewContainer}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={theme.success} />
                  <Text style={[styles.previewText, { color: theme.success }]}>
                    {new Money(parsedAmount, currentAccount?.currency || 'BDT').format(currentLocale)}
                  </Text>
                </View>
              )}
            </View>

            {/* Account Selector(s) */}
            {type === 'transfer' ? (
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                {/* Source Account */}
                <Text style={[styles.label, { color: theme.textMuted }]}>
                  {t('transactions.fromAccount')}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountChipScroll}>
                  {accounts.map((acc) => {
                    const isSelected = acc.id === sourceAccountId;
                    return (
                      <TouchableOpacity
                        key={`from-${acc.id}`}
                        style={[
                          styles.chip,
                          { borderColor: isSelected ? theme.primary : theme.border },
                          isSelected && { backgroundColor: theme.surfaceTinted },
                        ]}
                        onPress={() => setSourceAccountId(acc.id)}
                        accessibilityRole="button">
                        <Text
                          style={[
                            styles.chipText,
                            { color: isSelected ? theme.primary : theme.text },
                          ]}>
                          {acc.name} ({acc.currency})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* Destination Account */}
                <Text style={[styles.label, { color: theme.textMuted, marginTop: 14 }]}>
                  {t('transactions.toAccount')}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountChipScroll}>
                  {accounts.map((acc) => {
                    const isSelected = acc.id === destinationAccountId;
                    const isSame = acc.id === sourceAccountId;
                    return (
                      <TouchableOpacity
                        key={`to-${acc.id}`}
                        style={[
                          styles.chip,
                          { borderColor: isSelected ? theme.primary : theme.border },
                          isSelected && { backgroundColor: theme.surfaceTinted },
                          isSame && { opacity: 0.4 },
                        ]}
                        onPress={() => setDestinationAccountId(acc.id)}
                        accessibilityRole="button">
                        <Text
                          style={[
                            styles.chipText,
                            { color: isSelected ? theme.primary : theme.text },
                          ]}>
                          {acc.name} ({acc.currency})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.label, { color: theme.textMuted }]}>
                  {t('transactions.account')}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountChipScroll}>
                  {accounts.map((acc) => {
                    const isSelected = acc.id === selectedAccountId;
                    return (
                      <TouchableOpacity
                        key={acc.id}
                        style={[
                          styles.chip,
                          { borderColor: isSelected ? theme.primary : theme.border },
                          isSelected && { backgroundColor: theme.surfaceTinted },
                        ]}
                        onPress={() => setSelectedAccountId(acc.id)}
                        accessibilityRole="button">
                        <Text
                          style={[
                            styles.chipText,
                            { color: isSelected ? theme.primary : theme.text },
                          ]}>
                          {acc.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Category Selector (Income & Expense only) */}
            {type !== 'transfer' && (
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.label, { color: theme.textMuted }]}>
                  {t('transactions.category')}
                </Text>
                <View style={styles.categoryGrid}>
                  {availableCategories.map((cat) => {
                    const isSelected = cat.id === selectedCategoryId;
                    const displayName = getCategoryDisplayName(cat, currentLocale, t);
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[
                          styles.categoryItem,
                          { borderColor: isSelected ? theme.primary : theme.border },
                          isSelected && { backgroundColor: theme.surfaceTinted },
                        ]}
                        onPress={() => setSelectedCategoryId(cat.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}>
                        <Ionicons
                          name={(cat.icon as any) || 'pricetag-outline'}
                          size={18}
                          color={isSelected ? theme.primary : theme.textMuted}
                        />
                        <Text
                          style={[
                            styles.categoryItemText,
                            { color: isSelected ? theme.primary : theme.text },
                            isSelected && styles.categoryItemTextActive,
                          ]}
                          numberOfLines={1}>
                          {displayName}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Note Input */}
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.label, { color: theme.textMuted }]}>
                {t('transactions.note')}
              </Text>
              <TextInput
                style={[styles.noteInput, { color: theme.text, borderColor: theme.border }]}
                placeholder={t('transactions.notePlaceholder')}
                placeholderTextColor={theme.muted}
                value={note}
                onChangeText={setNote}
                maxLength={200}
                multiline
                accessibilityLabel={t('transactions.note')}
              />
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    padding: 6,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
  },
  primaryButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  typeSelector: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  typeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  typeTabText: {
    fontSize: 14,
    fontWeight: '500',
  },
  typeTabTextActive: {
    fontWeight: '700',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currencySymbol: {
    fontSize: 32,
    fontWeight: '600',
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '700',
    paddingVertical: 4,
  },
  previewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
  },
  previewText: {
    fontSize: 14,
    fontWeight: '600',
  },
  accountChipScroll: {
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  categoryItemText: {
    fontSize: 13,
  },
  categoryItemTextActive: {
    fontWeight: '600',
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
});
