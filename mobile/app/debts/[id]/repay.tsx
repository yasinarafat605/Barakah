import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Money, parseMoneyInput } from '@/src/domain/money';
import {
  getDebtById,
  getAccountsWithBalances,
  recordRepayment,
  DebtWithDetails,
  AccountWithBalance,
} from '@/src/db';

export default function AddRepaymentModal() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === 'en' ? 'en' : 'bn';

  const [debt, setDebt] = useState<DebtWithDetails | null>(null);
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [amountStr, setAmountStr] = useState('');
  const [note, setNote] = useState('');
  
  const now = new Date();
  const defaultDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const defaultTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const [dateStr, setDateStr] = useState(defaultDateStr);
  const [timeStr, setTimeStr] = useState(defaultTimeStr);

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      if (!id) return;
      try {
        setLoading(true);
        const [d, accList] = await Promise.all([
          getDebtById(id),
          getAccountsWithBalances(),
        ]);
        if (!isMounted) return;
        setDebt(d);
        // Filter accounts matching debt currency
        const matchingAccounts = accList.filter((a) => !d || a.currency === d.currency);
        setAccounts(matchingAccounts);
        if (matchingAccounts.length > 0) {
          setSelectedAccountId(matchingAccounts[0].id);
        }
      } catch (err) {
        console.error('Failed to load repayment screen dependencies:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [id]);

  // Live amount parsing
  const parsedAmount = useMemo<number | null>(() => {
    const trimmed = amountStr.trim();
    if (!trimmed) return null;
    const res = parseMoneyInput(trimmed, 2);
    return res.valid ? res.amountMinor : null;
  }, [amountStr]);

  // Timestamp parsing
  const parsedTimestamp = useMemo<number | null>(() => {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const timePattern = /^\d{2}:\d{2}$/;
    if (!datePattern.test(dateStr.trim()) || !timePattern.test(timeStr.trim())) {
      return null;
    }
    const [year, month, day] = dateStr.trim().split('-').map(Number);
    const [hour, minute] = timeStr.trim().split(':').map(Number);
    const d = new Date(year, month - 1, day, hour, minute);
    return d.getTime();
  }, [dateStr, timeStr]);

  // Shortcut to pay full outstanding amount
  const handlePayFullAmount = () => {
    if (!debt) return;
    const decimal = (debt.outstanding_principal / 100).toFixed(2);
    setAmountStr(decimal);
  };

  const handleSave = async () => {
    if (isSubmitting || !debt) return;
    setValidationError(null);

    // 1. Amount validation
    if (!amountStr.trim()) {
      setValidationError(t('debts.errors.amountRequired'));
      return;
    }
    if (parsedAmount === null || parsedAmount <= 0) {
      setValidationError(t('debts.errors.invalidAmount'));
      return;
    }

    // 2. Overpayment validation
    if (parsedAmount > debt.outstanding_principal) {
      const formattedOutstanding = new Money(debt.outstanding_principal).format(currentLocale);
      setValidationError(t('debts.errors.overpayment', { outstanding: formattedOutstanding }));
      return;
    }

    // 3. Account validation
    if (!selectedAccountId) {
      setValidationError(t('debts.errors.accountRequired'));
      return;
    }

    // 4. Timestamp validation
    if (parsedTimestamp === null) {
      setValidationError(t('transactions.invalidDate'));
      return;
    }

    try {
      setIsSubmitting(true);
      await recordRepayment({
        debtId: debt.id,
        amountMinor: parsedAmount,
        accountId: selectedAccountId,
        occurredAt: parsedTimestamp,
        note: note.trim() || undefined,
      });

      router.back();
    } catch (err: any) {
      console.error('Failed to record repayment:', err);
      setValidationError(err.message || t('debts.errors.repaymentFailed'));
    } finally {
      setIsSubmitting(false);
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
          <Text style={{ color: theme.text }}>Debt record not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={{ color: theme.primary }}>{t('actions.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isBorrowed = debt.direction === 'borrowed';
  const outstandingMoney = new Money(debt.outstanding_principal);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('actions.cancel')}
          >
            <Ionicons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {t('debts.addRepayment')}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Validation Error Banner */}
          {validationError && (
            <View style={[styles.errorBanner, { backgroundColor: '#FEE4E2' }]}>
              <Ionicons name="alert-circle" size={18} color={theme.error} />
              <Text style={[styles.errorText, { color: theme.error }]}>{validationError}</Text>
            </View>
          )}

          {/* Outstanding Card with Quick Pay Button */}
          <View style={[styles.outstandingCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.outstandingHeader}>
              <View>
                <Text style={[styles.outstandingLabel, { color: theme.textMuted }]}>
                  {debt.counterparty_name} • {isBorrowed ? t('debts.iOwe') : t('debts.owedToMe')}
                </Text>
                <Text
                  style={[
                    styles.outstandingAmount,
                    { color: isBorrowed ? theme.text : theme.primary },
                  ]}
                >
                  {outstandingMoney.format(currentLocale)}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.fullPayButton, { backgroundColor: theme.surfaceTinted }]}
                onPress={handlePayFullAmount}
                accessibilityRole="button"
              >
                <Ionicons name="flash-outline" size={14} color={theme.primary} />
                <Text style={[styles.fullPayText, { color: theme.primary }]}>
                  {t('debts.payFullAmount')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Repayment Amount */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
              {t('transactions.amount')} ({debt.currency})
            </Text>
            <View style={[styles.inputBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.currencySymbol, { color: theme.textMuted }]}>৳</Text>
              <TextInput
                style={[styles.amountInput, { color: theme.text }]}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={theme.textMuted}
                value={amountStr}
                onChangeText={setAmountStr}
              />
            </View>
            {parsedAmount !== null && (
              <Text style={[styles.previewAmount, { color: theme.primary }]}>
                {new Money(parsedAmount).format(currentLocale)}
              </Text>
            )}
          </View>

          {/* Account Selector */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
              {isBorrowed ? 'Paid From Account (Expense)' : 'Received Into Account (Income)'}
            </Text>
            {accounts.length === 0 ? (
              <Text style={{ color: theme.error }}>
                No {debt.currency} accounts available.
              </Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accountChipsContainer}>
                {accounts.map((acc) => {
                  const isSelected = acc.id === selectedAccountId;
                  return (
                    <TouchableOpacity
                      key={acc.id}
                      style={[
                        styles.accountChip,
                        {
                          backgroundColor: isSelected ? theme.surfaceTinted : theme.surface,
                          borderColor: isSelected ? theme.primary : theme.border,
                        },
                      ]}
                      onPress={() => setSelectedAccountId(acc.id)}
                    >
                      <Ionicons
                        name="wallet-outline"
                        size={16}
                        color={isSelected ? theme.primary : theme.textMuted}
                      />
                      <View>
                        <Text
                          style={[
                            styles.accountChipName,
                            {
                              color: isSelected ? theme.primary : theme.text,
                              fontWeight: isSelected ? '700' : '500',
                            },
                          ]}
                        >
                          {acc.name}
                        </Text>
                        <Text style={[styles.accountChipBalance, { color: theme.textMuted }]}>
                          {acc.balance.format(currentLocale)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* Date and Time */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
              {t('transactions.date')} & {t('transactions.time')}
            </Text>
            <View style={styles.dateTimeRow}>
              <View style={[styles.inputBox, { flex: 1, backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Ionicons name="calendar-outline" size={16} color={theme.textMuted} />
                <TextInput
                  style={[styles.textInput, { color: theme.text }]}
                  value={dateStr}
                  onChangeText={setDateStr}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textMuted}
                />
              </View>
              <View style={[styles.inputBox, { width: 110, backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Ionicons name="time-outline" size={16} color={theme.textMuted} />
                <TextInput
                  style={[styles.textInput, { color: theme.text }]}
                  value={timeStr}
                  onChangeText={setTimeStr}
                  placeholder="HH:MM"
                  placeholderTextColor={theme.textMuted}
                />
              </View>
            </View>
          </View>

          {/* Note */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
              {t('counterparties.note')} ({t('actions.cancel') ? 'Optional' : 'ঐচ্ছিক'})
            </Text>
            <View style={[styles.noteBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <TextInput
                style={[styles.noteInput, { color: theme.text }]}
                value={note}
                onChangeText={setNote}
                placeholder={t('counterparties.notePlaceholder')}
                placeholderTextColor={theme.textMuted}
                multiline
                maxLength={200}
              />
            </View>
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: theme.primary }]}
            onPress={handleSave}
            disabled={isSubmitting}
            accessibilityRole="button"
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>{t('actions.save')}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
  backButton: {
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
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  outstandingCard: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
  },
  outstandingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  outstandingLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  outstandingAmount: {
    fontSize: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  fullPayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  fullPayText: {
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
    gap: 8,
  },
  currencySymbol: {
    fontSize: 20,
    fontWeight: '600',
  },
  amountInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  previewAmount: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  accountChipsContainer: {
    gap: 8,
    paddingVertical: 4,
  },
  accountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  accountChipName: {
    fontSize: 13,
  },
  accountChipBalance: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 13,
  },
  noteBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
  },
  noteInput: {
    fontSize: 13,
    textAlignVertical: 'top',
  },
  saveButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
