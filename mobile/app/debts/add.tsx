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
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Money, parseMoneyInput } from '@/src/domain/money';
import {
  getCounterparties,
  createCounterparty,
  createDebt,
  getAccountsWithBalances,
  CounterpartyRow,
  AccountWithBalance,
  DebtDirection,
  DebtOpeningMode,
  CounterpartyType,
} from '@/src/db';

export default function AddDebtScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ counterpartyId?: string; direction?: DebtDirection }>();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === 'en' ? 'en' : 'bn';

  // Form State
  const [direction, setDirection] = useState<DebtDirection>(
    params.direction === 'lent' ? 'lent' : 'borrowed'
  );
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState<string>(
    params.counterpartyId || ''
  );
  const [amountStr, setAmountStr] = useState('');
  const [currency] = useState('BDT');
  const [openingMode, setOpeningMode] = useState<DebtOpeningMode>('new_with_cash');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  
  const now = new Date();
  const defaultDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [openedDateStr, setOpenedDateStr] = useState(defaultDateStr);
  const [hasDueDate, setHasDueDate] = useState(false);
  const [dueDateStr, setDueDateStr] = useState('');
  const [note, setNote] = useState('');

  // Auxiliary data
  const [counterparties, setCounterparties] = useState<CounterpartyRow[]>([]);
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Inline "New Counterparty" Modal state
  const [showNewCounterpartyModal, setShowNewCounterpartyModal] = useState(false);
  const [newCpName, setNewCpName] = useState('');
  const [newCpType, setNewCpType] = useState<CounterpartyType>('person');
  const [newCpPhone, setNewCpPhone] = useState('');
  const [newCpEmail, setNewCpEmail] = useState('');
  const [creatingCp, setCreatingCp] = useState(false);

  // Load Counterparties and Accounts
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoadingData(true);
        const [cpList, accList] = await Promise.all([
          getCounterparties({ isArchived: false }),
          getAccountsWithBalances(),
        ]);
        if (!isMounted) return;
        setCounterparties(cpList);
        setAccounts(accList);

        if (!selectedCounterpartyId && cpList.length > 0) {
          setSelectedCounterpartyId(cpList[0].id);
        }
        if (accList.length > 0) {
          setSelectedAccountId(accList[0].id);
        }
      } catch (err) {
        console.error('Failed to load add-debt form dependencies:', err);
      } finally {
        if (isMounted) setLoadingData(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [selectedCounterpartyId]);

  // Live amount parsing
  const parsedAmount = useMemo<number | null>(() => {
    const trimmed = amountStr.trim();
    if (!trimmed) return null;
    const res = parseMoneyInput(trimmed, 2);
    return res.valid ? res.amountMinor : null;
  }, [amountStr]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  );

  const selectedCounterparty = useMemo(
    () => counterparties.find((c) => c.id === selectedCounterpartyId),
    [counterparties, selectedCounterpartyId]
  );

  // Inline counterparty creation handler
  const handleCreateCounterparty = async () => {
    if (!newCpName.trim()) {
      Alert.alert(t('common.error'), t('counterparties.errors.nameRequired'));
      return;
    }

    try {
      setCreatingCp(true);
      const created = await createCounterparty({
        name: newCpName.trim(),
        type: newCpType,
        phone: newCpPhone.trim() || undefined,
        email: newCpEmail.trim() || undefined,
      });

      const updatedList = await getCounterparties({ isArchived: false });
      setCounterparties(updatedList);
      setSelectedCounterpartyId(created.id);
      setShowNewCounterpartyModal(false);
      setNewCpName('');
      setNewCpPhone('');
      setNewCpEmail('');
    } catch (err) {
      console.error('Failed to create counterparty inline:', err);
      Alert.alert(t('common.error'), 'Failed to create counterparty');
    } finally {
      setCreatingCp(false);
    }
  };

  // Submission handler
  const handleSave = async () => {
    if (isSubmitting) return;
    setValidationError(null);

    // 1. Counterparty validation
    if (!selectedCounterpartyId) {
      setValidationError(t('debts.errors.counterpartyRequired'));
      return;
    }

    // 2. Amount validation
    if (!amountStr.trim()) {
      setValidationError(t('debts.errors.amountRequired'));
      return;
    }
    if (parsedAmount === null || parsedAmount <= 0) {
      setValidationError(t('debts.errors.invalidAmount'));
      return;
    }

    // 3. Mode & Account validation
    if (openingMode === 'new_with_cash') {
      if (!selectedAccountId) {
        setValidationError(t('debts.errors.accountRequired'));
        return;
      }
      if (selectedAccount && selectedAccount.currency !== currency) {
        setValidationError(
          t('debts.errors.crossCurrency', {
            accountCurrency: selectedAccount.currency,
            debtCurrency: currency,
          })
        );
        return;
      }
    }

    // 4. Opened Date validation (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(openedDateStr.trim())) {
      setValidationError('Please enter opened date in YYYY-MM-DD format');
      return;
    }

    // 5. Due date validation if enabled
    if (hasDueDate && dueDateStr.trim()) {
      if (!dateRegex.test(dueDateStr.trim())) {
        setValidationError('Please enter due date in YYYY-MM-DD format');
        return;
      }
    }

    // 6. Note validation
    if (note.length > 200) {
      setValidationError('Note must be 200 characters or less');
      return;
    }

    const [oYear, oMonth, oDay] = openedDateStr.trim().split('-').map(Number);
    const openedAt = new Date(oYear, oMonth - 1, oDay).getTime();

    const dueDate = hasDueDate && dueDateStr.trim() ? dueDateStr.trim() : undefined;

    try {
      setIsSubmitting(true);
      await createDebt({
        counterpartyId: selectedCounterpartyId,
        direction,
        originalPrincipalMinor: parsedAmount,
        currency,
        openingMode,
        accountId: openingMode === 'new_with_cash' ? selectedAccountId : undefined,
        openedAt,
        dueDate,
        note: note.trim() || undefined,
      });

      router.back();
    } catch (err: any) {
      console.error('Failed to create debt:', err);
      setValidationError(err.message || t('debts.errors.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <Text style={[styles.headerTitle, { color: theme.text }]}>{t('debts.addDebt')}</Text>
          <View style={{ width: 24 }} />
        </View>

        {loadingData ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {/* Validation Error Banner */}
            {validationError && (
              <View style={[styles.errorBanner, { backgroundColor: '#FEE4E2' }]}>
                <Ionicons name="alert-circle" size={18} color={theme.error} />
                <Text style={[styles.errorText, { color: theme.error }]}>{validationError}</Text>
              </View>
            )}

            {/* 1. Direction Selector (Borrowed vs Lent) */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
                {t('debts.openingMode') || 'Debt Direction'}
              </Text>
              <View style={[styles.directionToggle, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <TouchableOpacity
                  style={[
                    styles.directionOption,
                    direction === 'borrowed' && [
                      styles.directionOptionActive,
                      { backgroundColor: theme.surfaceTinted },
                    ],
                  ]}
                  onPress={() => setDirection('borrowed')}
                >
                  <Ionicons
                    name="arrow-down-circle"
                    size={20}
                    color={direction === 'borrowed' ? theme.moneyOut : theme.textMuted}
                  />
                  <Text
                    style={[
                      styles.directionOptionText,
                      {
                        color: direction === 'borrowed' ? theme.moneyOut : theme.textMuted,
                        fontWeight: direction === 'borrowed' ? '700' : '500',
                      },
                    ]}
                  >
                    {t('debts.borrowed')} ({t('debts.iOwe')})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.directionOption,
                    direction === 'lent' && [
                      styles.directionOptionActive,
                      { backgroundColor: theme.surfaceTinted },
                    ],
                  ]}
                  onPress={() => setDirection('lent')}
                >
                  <Ionicons
                    name="arrow-up-circle"
                    size={20}
                    color={direction === 'lent' ? theme.moneyIn : theme.textMuted}
                  />
                  <Text
                    style={[
                      styles.directionOptionText,
                      {
                        color: direction === 'lent' ? theme.moneyIn : theme.textMuted,
                        fontWeight: direction === 'lent' ? '700' : '500',
                      },
                    ]}
                  >
                    {t('debts.lent')} ({t('debts.owedToMe')})
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.helperText, { color: theme.textMuted }]}>
                {direction === 'borrowed' ? t('debts.borrowedDesc') : t('debts.lentDesc')}
              </Text>
            </View>

            {/* 2. Counterparty Picker */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
                  {t('debts.counterparty')}
                </Text>
                <TouchableOpacity
                  onPress={() => setShowNewCounterpartyModal(true)}
                  style={styles.addInlineButton}
                >
                  <Ionicons name="person-add-outline" size={14} color={theme.primary} />
                  <Text style={[styles.addInlineText, { color: theme.primary }]}>
                    {t('debts.addCounterparty')}
                  </Text>
                </TouchableOpacity>
              </View>

              {counterparties.length === 0 ? (
                <TouchableOpacity
                  style={[styles.emptyPickerBox, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  onPress={() => setShowNewCounterpartyModal(true)}
                >
                  <Ionicons name="add-circle-outline" size={24} color={theme.primary} />
                  <Text style={[styles.emptyPickerText, { color: theme.primary }]}>
                    {t('debts.addCounterparty')}
                  </Text>
                </TouchableOpacity>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cpChipsContainer}>
                  {counterparties.map((cp) => {
                    const isSelected = cp.id === selectedCounterpartyId;
                    return (
                      <TouchableOpacity
                        key={cp.id}
                        style={[
                          styles.cpChip,
                          {
                            backgroundColor: isSelected ? theme.surfaceTinted : theme.surface,
                            borderColor: isSelected ? theme.primary : theme.border,
                          },
                        ]}
                        onPress={() => setSelectedCounterpartyId(cp.id)}
                      >
                        <Ionicons
                          name="person"
                          size={14}
                          color={isSelected ? theme.primary : theme.textMuted}
                        />
                        <Text
                          style={[
                            styles.cpChipText,
                            {
                              color: isSelected ? theme.primary : theme.text,
                              fontWeight: isSelected ? '700' : '400',
                            },
                          ]}
                        >
                          {cp.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            {/* 3. Principal Amount */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
                {t('debts.originalPrincipal')} ({currency})
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
                  accessibilityLabel={t('debts.originalPrincipal')}
                />
              </View>
              {parsedAmount !== null && (
                <Text style={[styles.previewAmount, { color: theme.primary }]}>
                  {new Money(parsedAmount).format(currentLocale)}
                </Text>
              )}
            </View>

            {/* 4. Opening Mode (New Cash Movement vs Existing Balance) */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
                {t('debts.openingMode')}
              </Text>
              <TouchableOpacity
                style={[
                  styles.modeCard,
                  {
                    backgroundColor: theme.surface,
                    borderColor: openingMode === 'new_with_cash' ? theme.primary : theme.border,
                  },
                ]}
                onPress={() => setOpeningMode('new_with_cash')}
              >
                <View style={styles.modeCardLeft}>
                  <Ionicons
                    name={openingMode === 'new_with_cash' ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={openingMode === 'new_with_cash' ? theme.primary : theme.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modeTitle, { color: theme.text }]}>
                      {t('debts.newWithCash')}
                    </Text>
                    <Text style={[styles.modeDesc, { color: theme.textMuted }]}>
                      {direction === 'borrowed'
                        ? 'Creates an income transaction and increases selected account balance.'
                        : 'Creates an expense transaction and decreases selected account balance.'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modeCard,
                  {
                    backgroundColor: theme.surface,
                    borderColor: openingMode === 'existing_balance' ? theme.primary : theme.border,
                  },
                ]}
                onPress={() => setOpeningMode('existing_balance')}
              >
                <View style={styles.modeCardLeft}>
                  <Ionicons
                    name={openingMode === 'existing_balance' ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={openingMode === 'existing_balance' ? theme.primary : theme.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modeTitle, { color: theme.text }]}>
                      {t('debts.existingBalance')}
                    </Text>
                    <Text style={[styles.modeDesc, { color: theme.textMuted }]}>
                      Historical debt from the past. Does not change any account balance.
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>

            {/* 5. Account Selection (if new_with_cash) */}
            {openingMode === 'new_with_cash' && (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
                  {t('debts.account')}
                </Text>
                {accounts.length === 0 ? (
                  <Text style={{ color: theme.error }}>
                    No accounts available. Please create an account first.
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
            )}

            {/* 6. Opened Date & Due Date */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
                {t('debts.openedDate')} (YYYY-MM-DD)
              </Text>
              <View style={[styles.inputBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Ionicons name="calendar-outline" size={18} color={theme.textMuted} />
                <TextInput
                  style={[styles.textInput, { color: theme.text }]}
                  value={openedDateStr}
                  onChangeText={setOpenedDateStr}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textMuted}
                />
              </View>

              <View style={styles.dueDateToggleRow}>
                <TouchableOpacity
                  style={styles.checkboxRow}
                  onPress={() => {
                    const next = !hasDueDate;
                    setHasDueDate(next);
                    if (next && !dueDateStr) {
                      const future = new Date();
                      future.setMonth(future.getMonth() + 1);
                      setDueDateStr(`${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`);
                    }
                  }}
                >
                  <Ionicons
                    name={hasDueDate ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={hasDueDate ? theme.primary : theme.textMuted}
                  />
                  <Text style={[styles.checkboxLabel, { color: theme.text }]}>
                    {t('debts.dueDate')}
                  </Text>
                </TouchableOpacity>
              </View>

              {hasDueDate && (
                <View style={[styles.inputBox, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 8 }]}>
                  <Ionicons name="calendar-outline" size={18} color={theme.textMuted} />
                  <TextInput
                    style={[styles.textInput, { color: theme.text }]}
                    value={dueDateStr}
                    onChangeText={setDueDateStr}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
              )}
            </View>

            {/* 7. Note */}
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

            {/* 8. Summary Review Card */}
            {selectedCounterparty && parsedAmount !== null && parsedAmount > 0 && (
              <View style={[styles.reviewCard, { backgroundColor: theme.surfaceTinted, borderColor: theme.border }]}>
                <Text style={[styles.reviewTitle, { color: theme.primary }]}>
                  {t('transactions.title') || 'Summary Review'}
                </Text>
                <View style={styles.reviewRow}>
                  <Text style={[styles.reviewLabel, { color: theme.textMuted }]}>{t('debts.counterparty')}:</Text>
                  <Text style={[styles.reviewValue, { color: theme.text }]}>{selectedCounterparty.name}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={[styles.reviewLabel, { color: theme.textMuted }]}>{t('debts.originalPrincipal')}:</Text>
                  <Text style={[styles.reviewValue, { color: theme.text, fontWeight: '700' }]}>
                    {new Money(parsedAmount).format(currentLocale)}
                  </Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={[styles.reviewLabel, { color: theme.textMuted }]}>Direction:</Text>
                  <Text style={[styles.reviewValue, { color: direction === 'borrowed' ? theme.moneyOut : theme.moneyIn }]}>
                    {direction === 'borrowed' ? t('debts.borrowed') : t('debts.lent')}
                  </Text>
                </View>
                {openingMode === 'new_with_cash' && selectedAccount && (
                  <View style={styles.reviewRow}>
                    <Text style={[styles.reviewLabel, { color: theme.textMuted }]}>{t('debts.account')}:</Text>
                    <Text style={[styles.reviewValue, { color: theme.text }]}>{selectedAccount.name}</Text>
                  </View>
                )}
              </View>
            )}

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
        )}

        {/* Inline New Counterparty Modal */}
        <Modal
          visible={showNewCounterpartyModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowNewCounterpartyModal(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>
                  {t('counterparties.addCounterparty')}
                </Text>
                <TouchableOpacity onPress={() => setShowNewCounterpartyModal(false)}>
                  <Ionicons name="close" size={22} color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 400 }}>
                {/* Name */}
                <Text style={[styles.modalLabel, { color: theme.textMuted }]}>
                  {t('counterparties.name')} *
                </Text>
                <TextInput
                  style={[styles.modalInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                  placeholder={t('counterparties.namePlaceholder')}
                  placeholderTextColor={theme.textMuted}
                  value={newCpName}
                  onChangeText={setNewCpName}
                />

                {/* Type */}
                <Text style={[styles.modalLabel, { color: theme.textMuted, marginTop: 12 }]}>
                  {t('counterparties.type')}
                </Text>
                <View style={styles.typeRow}>
                  {(['person', 'business', 'organisation', 'other'] as CounterpartyType[]).map((typeKey) => (
                    <TouchableOpacity
                      key={typeKey}
                      style={[
                        styles.typeButton,
                        newCpType === typeKey && [styles.typeButtonActive, { backgroundColor: theme.surfaceTinted, borderColor: theme.primary }],
                        { borderColor: theme.border },
                      ]}
                      onPress={() => setNewCpType(typeKey)}
                    >
                      <Text
                        style={[
                          styles.typeButtonText,
                          { color: newCpType === typeKey ? theme.primary : theme.textMuted },
                        ]}
                      >
                        {t(`counterparties.types.${typeKey}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Phone */}
                <Text style={[styles.modalLabel, { color: theme.textMuted, marginTop: 12 }]}>
                  {t('counterparties.phone')}
                </Text>
                <TextInput
                  style={[styles.modalInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                  placeholder={t('counterparties.phonePlaceholder')}
                  placeholderTextColor={theme.textMuted}
                  keyboardType="phone-pad"
                  value={newCpPhone}
                  onChangeText={setNewCpPhone}
                />

                {/* Email */}
                <Text style={[styles.modalLabel, { color: theme.textMuted, marginTop: 12 }]}>
                  {t('counterparties.email')}
                </Text>
                <TextInput
                  style={[styles.modalInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                  placeholder={t('counterparties.emailPlaceholder')}
                  placeholderTextColor={theme.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={newCpEmail}
                  onChangeText={setNewCpEmail}
                />
              </ScrollView>

              <TouchableOpacity
                style={[styles.modalSaveButton, { backgroundColor: theme.primary }]}
                onPress={handleCreateCounterparty}
                disabled={creatingCp}
              >
                {creatingCp ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSaveButtonText}>
                    {t('counterparties.createCounterparty')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  section: {
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
  },
  directionToggle: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 6,
  },
  directionOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  directionOptionActive: {},
  directionOptionText: {
    fontSize: 13,
  },
  addInlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addInlineText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyPickerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 8,
  },
  emptyPickerText: {
    fontSize: 14,
    fontWeight: '600',
  },
  cpChipsContainer: {
    gap: 8,
    paddingVertical: 4,
  },
  cpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  cpChipText: {
    fontSize: 13,
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
  modeCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  modeCardLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  modeTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  modeDesc: {
    fontSize: 11,
    lineHeight: 15,
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
  textInput: {
    flex: 1,
    fontSize: 14,
  },
  dueDateToggleRow: {
    marginTop: 4,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkboxLabel: {
    fontSize: 13,
    fontWeight: '500',
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
  reviewCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  reviewTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewLabel: {
    fontSize: 12,
  },
  reviewValue: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  modalInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 42,
    fontSize: 13,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  typeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeButtonActive: {},
  typeButtonText: {
    fontSize: 11,
    fontWeight: '600',
  },
  modalSaveButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  modalSaveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
