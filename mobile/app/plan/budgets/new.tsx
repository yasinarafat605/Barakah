import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { createBudget, getAccounts, getBudgets, getCategories } from '@/src/db';
import type { AccountWithBalance, BudgetRow, CategoryRow } from '@/src/db/types';
import { parseMoneyInput } from '@/src/domain/money';

function minor(value: string): number {
  const result = parseMoneyInput(value);
  if (!result.valid) throw new Error(result.error);
  return result.amountMinor;
}

function currentMonth(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { start: format(new Date(year, month, 1)), end: format(new Date(year, month + 1, 0)) };
}

export default function NewBudget() {
  const router = useRouter();
  const { t } = useTranslation();
  const defaults = useMemo(currentMonth, []);
  const [name, setName] = useState('');
  const [periodType, setPeriodType] = useState<'monthly' | 'custom'>('monthly');
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [limit, setLimit] = useState('');
  const [income, setIncome] = useState('');
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [priorBudgets, setPriorBudgets] = useState<BudgetRow[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState<string | null>(null);
  const [rollover, setRollover] = useState(false);
  const [rolloverSourceId, setRolloverSourceId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getAccounts(), getCategories({ type: 'expense', isArchived: false }), getBudgets({ archived: false })])
      .then(([rows, categoryRows, budgetRows]) => {
        setAccounts(rows.filter((account) => account.archived_at === null));
        setCategories(categoryRows);
        setPriorBudgets(budgetRows);
      })
      .catch(console.error);
  }, []);

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const currency = selectedAccount?.currency ?? 'BDT';
  const eligibleSources = priorBudgets.filter((budget) =>
    budget.currency === currency && budget.account_id === accountId && budget.ends_on < start && budget.expense_limit !== null
  );

  const save = async () => {
    try {
      const planned = categories
        .filter((category) => allocations[category.id]?.trim())
        .map((category) => ({ categoryId: category.id, amountMinor: minor(allocations[category.id]) }));
      await createBudget({
        name,
        periodType,
        startsOn: start,
        endsOn: end,
        currency,
        accountId,
        incomeTargetMinor: income.trim() ? minor(income) : null,
        expenseLimitMinor: limit.trim() ? minor(limit) : null,
        rolloverPolicy: rollover ? 'unspent_only' : 'none',
        rolloverFromBudgetId: rollover ? rolloverSourceId : null,
        categories: planned,
      });
      router.back();
    } catch (error) {
      Alert.alert(t('planning.budgetNotSaved'), error instanceof Error ? error.message : t('status.error'));
    }
  };

  return <SafeAreaView style={styles.safe}>
    <Stack.Screen options={{ title: t('planning.newBudget') }} />
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.label}>{t('planning.nameOptional')}</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} />
      <Text style={styles.label}>{t('planning.period')}</Text>
      <TouchableOpacity accessibilityRole="button" style={[styles.choice, periodType === 'monthly' && styles.selected]} onPress={() => setPeriodType('monthly')}><Text>{t('planning.monthly')}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={[styles.choice, periodType === 'custom' && styles.selected]} onPress={() => setPeriodType('custom')}><Text>{t('planning.custom')}</Text></TouchableOpacity>
      <Text style={styles.label}>{t('planning.startsOn')}</Text>
      <TextInput style={styles.input} value={start} onChangeText={setStart} autoCapitalize="none" />
      <Text style={styles.label}>{t('planning.endsOn')}</Text>
      <TextInput style={styles.input} value={end} onChangeText={setEnd} autoCapitalize="none" />
      <Text style={styles.label}>{t('planning.incomeTargetOptional')}</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={income} onChangeText={setIncome} />
      <Text style={styles.label}>{t('planning.expenseLimitOptional')}</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={limit} onChangeText={setLimit} />
      <Text style={styles.label}>{t('planning.categoryAllocations')}</Text>
      {categories.map((category) => <TextInput key={category.id} style={styles.input} keyboardType="decimal-pad" value={allocations[category.id] ?? ''} onChangeText={(value) => setAllocations((current) => ({ ...current, [category.id]: value }))} placeholder={category.name_custom || t(category.name_key)} />)}
      <Text style={styles.label}>{t('planning.scope')}</Text>
      <TouchableOpacity accessibilityRole="button" style={[styles.choice, !accountId && styles.selected]} onPress={() => { setAccountId(null); setRolloverSourceId(null); }}><Text>{t('planning.allCurrencyAccounts', { currency: 'BDT' })}</Text></TouchableOpacity>
      {accounts.map((account) => <TouchableOpacity accessibilityRole="button" key={account.id} style={[styles.choice, accountId === account.id && styles.selected]} onPress={() => { setAccountId(account.id); setRolloverSourceId(null); }}><Text>{account.name} ({account.currency})</Text></TouchableOpacity>)}
      <Text style={styles.label}>{t('planning.rollover')}</Text>
      <TouchableOpacity accessibilityRole="button" style={[styles.choice, !rollover && styles.selected]} onPress={() => { setRollover(false); setRolloverSourceId(null); }}><Text>{t('planning.noRollover')}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={[styles.choice, rollover && styles.selected]} onPress={() => setRollover(true)}><Text>{t('planning.unspentOnly')}</Text></TouchableOpacity>
      {rollover && <><Text style={styles.label}>{t('planning.rolloverSource')}</Text>{eligibleSources.map((budget) => <TouchableOpacity accessibilityRole="button" key={budget.id} style={[styles.choice, rolloverSourceId === budget.id && styles.selected]} onPress={() => setRolloverSourceId(budget.id)}><Text>{budget.name || `${budget.starts_on} – ${budget.ends_on}`}</Text></TouchableOpacity>)}</>}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('planning.saveBudget')} style={styles.button} onPress={save}><Text style={styles.buttonText}>{t('planning.saveBudget')}</Text></TouchableOpacity>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F6F8F7' }, body: { padding: 20, gap: 9 }, label: { fontWeight: '600', marginTop: 6 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D7DEDA', borderRadius: 10, padding: 12 }, choice: { backgroundColor: '#fff', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#D7DEDA' }, selected: { borderColor: '#087A62', borderWidth: 2 }, button: { backgroundColor: '#087A62', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 14 }, buttonText: { color: '#fff', fontWeight: '700' } });
