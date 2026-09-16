import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { createSavingsGoal, getAccounts } from '@/src/db';
import type { AccountWithBalance } from '@/src/db/types';
import { parseMoneyInput } from '@/src/domain/money';

function minor(value: string): number {
  const result = parseMoneyInput(value);
  if (!result.valid) throw new Error(result.error);
  return result.amountMinor;
}

export default function NewGoal() {
  const router = useRouter();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  useEffect(() => { getAccounts().then((rows) => setAccounts(rows.filter((account) => account.archived_at === null))).catch(console.error); }, []);
  const save = async () => {
    try {
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account) throw new Error(t('planning.chooseAccount'));
      await createSavingsGoal({ name, targetAmountMinor: minor(target), currency: account.currency, linkedAccountId: account.id });
      router.back();
    } catch (error) {
      Alert.alert(t('planning.goalNotSaved'), error instanceof Error ? error.message : t('status.error'));
    }
  };
  return <SafeAreaView style={styles.safe}>
    <Stack.Screen options={{ title: t('planning.newGoal') }} />
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.label}>{t('planning.goalName')}</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} />
      <Text style={styles.label}>{t('planning.targetAmount')}</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={target} onChangeText={setTarget} />
      <Text style={styles.label}>{t('planning.fundingAccount')}</Text>
      {accounts.map((account) => <TouchableOpacity accessibilityRole="button" key={account.id} style={[styles.choice, accountId === account.id && styles.selected]} onPress={() => setAccountId(account.id)}><Text>{account.name} ({account.currency})</Text></TouchableOpacity>)}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('planning.saveGoal')} style={styles.button} onPress={save}><Text style={styles.buttonText}>{t('planning.saveGoal')}</Text></TouchableOpacity>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F6F8F7' }, body: { padding: 20, gap: 9 }, label: { fontWeight: '600', marginTop: 6 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D7DEDA', borderRadius: 10, padding: 12 }, choice: { backgroundColor: '#fff', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#D7DEDA' }, selected: { borderColor: '#087A62', borderWidth: 2 }, button: { backgroundColor: '#087A62', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 14 }, buttonText: { color: '#fff', fontWeight: '700' } });
