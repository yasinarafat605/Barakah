import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getBudgets, getSavingsGoals } from '@/src/db';
import type { BudgetRow, SavingsGoalRow } from '@/src/db/types';
import { formatMinorUnits } from '@/src/domain/money';

export default function PlanScreen() {
  const theme=Colors[useColorScheme() ?? 'light']; const router=useRouter();
  const {t,i18n}=useTranslation();
  const [budgets,setBudgets]=useState<BudgetRow[]>([]); const [goals,setGoals]=useState<SavingsGoalRow[]>([]);
  useFocusEffect(useCallback(()=>{let mounted=true;Promise.all([getBudgets({archived:false}),getSavingsGoals()]).then(([b,g])=>{if(mounted){setBudgets(b);setGoals(g);}}).catch(console.error);return()=>{mounted=false;};},[]));
  const card={backgroundColor:theme.surface,borderColor:theme.border};
  return <SafeAreaView style={[styles.safe,{backgroundColor:theme.background}]}><ScrollView contentContainerStyle={styles.body}>
    <Text style={[styles.title,{color:theme.text}]}>{t('nav.plan')}</Text><Text style={{color:theme.textMuted}}>{t('planning.subtitle')}</Text>
    <View style={styles.heading}><Text style={[styles.section,{color:theme.text}]}>{t('planning.budgets')}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={t('planning.newBudget')} onPress={()=>router.push('/plan/budgets/new' as any)}><Ionicons name="add-circle" size={28} color={theme.primary}/></TouchableOpacity></View>
    {budgets.length===0?<Text style={{color:theme.textMuted}}>{t('planning.noBudgets')}</Text>:budgets.map(b=><TouchableOpacity key={b.id} style={[styles.card,card]} onPress={()=>router.push(`/plan/budgets/${b.id}` as any)}><Text style={[styles.cardTitle,{color:theme.text}]}>{b.name || `${b.starts_on} – ${b.ends_on}`}</Text><Text style={{color:theme.textMuted}}>{b.currency} · {t(b.account_id?'planning.accountBudget':'planning.overallBudget')}</Text></TouchableOpacity>)}
    <View style={styles.heading}><Text style={[styles.section,{color:theme.text}]}>{t('planning.goals')}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={t('planning.newGoal')} onPress={()=>router.push('/plan/goals/new' as any)}><Ionicons name="add-circle" size={28} color={theme.primary}/></TouchableOpacity></View>
    {goals.length===0?<Text style={{color:theme.textMuted}}>{t('planning.noGoals')}</Text>:goals.map(g=><TouchableOpacity accessibilityRole="button" key={g.id} style={[styles.card,card]} onPress={()=>router.push(`/plan/goals/${g.id}` as any)}><Text style={[styles.cardTitle,{color:theme.text}]}>{g.name}</Text><Text style={{color:theme.textMuted}}>{formatMinorUnits(g.target_amount,g.currency,i18n.language.startsWith('bn')?'bn':'en')} · {t(`planning.${g.lifecycle_status}`)}</Text></TouchableOpacity>)}
  </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1},body:{padding:20,gap:12},title:{fontSize:28,fontWeight:'700'},heading:{marginTop:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},section:{fontSize:20,fontWeight:'700'},card:{padding:16,borderWidth:1,borderRadius:14,gap:5},cardTitle:{fontSize:16,fontWeight:'600'}});
