import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { getSavingsGoalProgress, recordGoalAllocation } from '@/src/db';
import { parseMoneyInput } from '@/src/domain/money';

type Progress = Awaited<ReturnType<typeof getSavingsGoalProgress>>;

export default function GoalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const [data, setData] = useState<Progress | null>(null);
  const [amount, setAmount] = useState('');
  const load = useCallback(() => { getSavingsGoalProgress(id).then(setData).catch((error) => Alert.alert(t('planning.goalUnavailable'), String(error))); }, [id, t]);
  useFocusEffect(load);
  if (!data) return <SafeAreaView style={styles.safe}><Text style={styles.body}>{t('status.loading')}</Text></SafeAreaView>;
  const add = async (type: 'contribution' | 'withdrawal') => {
    try {
      const parsed = parseMoneyInput(amount);
      if (!parsed.valid) throw new Error(parsed.error);
      await recordGoalAllocation({ goalId: id, entryType: type, amountMinor: parsed.amountMinor });
      setAmount('');
      load();
    } catch (error) {
      Alert.alert(t('planning.allocationNotSaved'), error instanceof Error ? error.message : t('status.error'));
    }
  };
  const shortfall = data.funding ? `${data.goal.currency} ${(data.funding.fundingShortfall / 100).toFixed(2)}` : '';
  return <SafeAreaView style={styles.safe}>
    <Stack.Screen options={{ title: data.goal.name }} />
    <View style={styles.body}>
      <Text style={styles.title}>{data.goal.name}</Text>
      <Text>{data.goal.currency} {(data.current / 100).toFixed(2)} / {(data.goal.target_amount / 100).toFixed(2)}</Text>
      <Text>{(data.progressBp / 100).toFixed(2)}% · {t(`planning.${data.lifecycleStatus}`)}</Text>
      <Text style={styles.note}>{t('planning.earmarkNotice')}</Text>
      {data.funding?.underfunded && <Text style={styles.warning}>{t('planning.underfundedBy', { amount: shortfall })}</Text>}
      <TextInput accessibilityLabel={t('planning.amount')} style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={t('planning.amount')} />
      <View style={styles.row}>
        <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => add('contribution')}><Text style={styles.buttonText}>{t('planning.allocate')}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={() => add('withdrawal')}><Text>{t('planning.unallocate')}</Text></TouchableOpacity>
      </View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F6F8F7' }, body: { padding: 20, gap: 14 }, title: { fontSize: 24, fontWeight: '700' }, note: { color: '#5E6C65', lineHeight: 20 }, warning: { color: '#B5473A', fontWeight: '600' }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D7DEDA', borderRadius: 10, padding: 12 }, row: { flexDirection: 'row', gap: 10 }, button: { backgroundColor: '#087A62', padding: 14, borderRadius: 10 }, secondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D7DEDA', padding: 14, borderRadius: 10 }, buttonText: { color: '#fff', fontWeight: '700' } });
