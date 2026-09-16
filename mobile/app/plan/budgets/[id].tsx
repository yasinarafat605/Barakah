import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { archiveBudget, duplicateBudget, getBudgetPerformance } from '@/src/db';
import type { BudgetPerformance } from '@/src/db/budgets';

function nextPeriod(periodType: 'monthly' | 'custom', startsOn: string, endsOn: string): { startsOn: string; endsOn: string } {
  const day = 86_400_000;
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  const nextStart = end + day;
  const nextStartDate = new Date(nextStart);
  const nextEnd = periodType === 'monthly'
    ? Date.UTC(nextStartDate.getUTCFullYear(), nextStartDate.getUTCMonth() + 1, 0)
    : nextStart + (end - start);
  return { startsOn: new Date(nextStart).toISOString().slice(0, 10), endsOn: new Date(nextEnd).toISOString().slice(0, 10) };
}

export default function BudgetDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const [data, setData] = useState<BudgetPerformance | null>(null);
  const load = useCallback(() => { getBudgetPerformance(id).then(setData).catch((error) => Alert.alert(t('planning.budgetUnavailable'), String(error))); }, [id, t]);
  useFocusEffect(load);
  if (!data) return <SafeAreaView style={styles.safe}><Text style={styles.body}>{t('status.loading')}</Text></SafeAreaView>;
  const money = (value: number | null) => value === null ? '—' : `${data.budget.currency} ${(value / 100).toFixed(2)}`;
  const duplicate = async () => {
    try {
      const created = await duplicateBudget(id, nextPeriod(data.budget.period_type, data.budget.starts_on, data.budget.ends_on));
      router.replace(`/plan/budgets/${created.id}` as never);
    } catch (error) {
      Alert.alert(t('planning.duplicateFailed'), error instanceof Error ? error.message : t('status.error'));
    }
  };
  return <SafeAreaView style={styles.safe}>
    <Stack.Screen options={{ title: data.budget.name || t('planning.budget') }} />
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.title}>{data.budget.name || t('planning.budget')}</Text>
      <Text>{data.budget.starts_on} – {data.budget.ends_on}</Text>
      <View style={styles.card}>
        <Text>{t('planning.effectiveLimit')}: {money(data.effectiveExpenseLimit)}</Text>
        <Text>{t('planning.actual')}: {money(data.overallActual)}</Text>
        <Text>{t('planning.remaining')}: {money(data.remaining)}</Text>
        <Text>{t('planning.unallocatedPlan')}: {money(data.unallocated)}</Text>
        <Text>{t('planning.incomeActual')}: {money(data.incomeActual)}</Text>
      </View>
      {data.categories.map((category) => <View key={category.id} style={styles.card}><Text>{category.category_id}</Text><Text>{money(category.actual)} / {money(category.amount)}</Text></View>)}
      <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={duplicate}><Text style={styles.buttonText}>{t('planning.duplicateNextPeriod')}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => archiveBudget(id).then(() => router.back())}><Text style={styles.buttonText}>{t('planning.archiveBudget')}</Text></TouchableOpacity>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F6F8F7' }, body: { padding: 20, gap: 12 }, title: { fontSize: 24, fontWeight: '700' }, card: { backgroundColor: '#fff', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#D7DEDA', gap: 7 }, primaryButton: { padding: 14, borderRadius: 10, backgroundColor: '#087A62', alignItems: 'center' }, button: { padding: 14, borderRadius: 10, backgroundColor: '#58665F', alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '700' } });
