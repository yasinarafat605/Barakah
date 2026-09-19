import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { createSavingsGoal, getAccounts, getSavingsGoalById, updateSavingsGoal } from '@/src/db';
import type { AccountWithBalance } from '@/src/db/types';
import { formatMinorUnits, parseMoneyInput, SUPPORTED_CURRENCIES } from '@/src/domain/money';
import { planningErrorMessage } from '@/src/domain/planning-error';
import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDirtyFormGuard } from '@/hooks/use-dirty-form-guard';

export default function GoalForm() {
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const router = useRouter(); const { t, i18n } = useTranslation(); const theme = Colors[useColorScheme() ?? 'light'];
  const locale = i18n.language.startsWith('bn') ? 'bn' : 'en';
  const [name,setName]=useState(''); const [target,setTarget]=useState(''); const [currency,setCurrency]=useState('');
  const [targetDate,setTargetDate]=useState(''); const [note,setNote]=useState(''); const [accounts,setAccounts]=useState<AccountWithBalance[]>([]);
  const [accountId,setAccountId]=useState<string|null>(null); const [saving,setSaving]=useState(false); const [loaded,setLoaded]=useState(!editId);
  const submitting=useRef(false);
  const snapshot=JSON.stringify({name,target,currency,targetDate,note,accountId}); const baseline=useRef<string|null>(null);
  useEffect(()=>{if(loaded&&baseline.current===null)baseline.current=snapshot;},[loaded,snapshot]);
  const allowExit=useDirtyFormGuard(baseline.current!==null&&snapshot!==baseline.current,t('planning.discardTitle'),t('planning.discardMessage'),t('actions.cancel'),t('planning.discard'));
  useEffect(()=>{Promise.all([getAccounts(),editId?getSavingsGoalById(editId):Promise.resolve(null)]).then(([rows,goal])=>{
    setAccounts(rows.filter(a=>a.archived_at===null)); if(goal){setName(goal.name);setCurrency(goal.currency);setAccountId(goal.linked_account_id);setTargetDate(goal.target_date??'');setNote(goal.note??'');setTarget(formatMinorUnits(goal.target_amount,goal.currency,'en').replace(/^[^0-9]*/, '').replace(/,/g,''));} setLoaded(true);
  }).catch(e=>Alert.alert(t('planning.goalUnavailable'),planningErrorMessage(e,t)));},[editId,t]);
  const parsed=useMemo(()=>currency?parseMoneyInput(target,currency):{valid:false,amountMinor:0},[target,currency]);
  const chooseAccount=(account:AccountWithBalance)=>{setAccountId(account.id);setCurrency(account.currency);};
  const submit=async()=>{if(submitting.current)return; submitting.current=true;try{if(!parsed.valid)throw new Error('GOAL_ERR_INVALID_TARGET');setSaving(true);const input={name,targetAmountMinor:parsed.amountMinor,currency,targetDate:targetDate.trim()||null,linkedAccountId:accountId,note};if(editId)await updateSavingsGoal(editId,input);else await createSavingsGoal(input);allowExit();router.back();}catch(e){Alert.alert(t('planning.goalNotSaved'),planningErrorMessage(e,t));}finally{submitting.current=false;setSaving(false);}};
  const review=()=>{if(!currency||!parsed.valid){Alert.alert(t('planning.goalNotSaved'),t('planning.errors.generic'));return;}Alert.alert(t('planning.reviewGoal'),`${name}\n${formatMinorUnits(parsed.amountMinor,currency,locale)}\n${targetDate||'—'}`, [{text:t('actions.cancel'),style:'cancel'},{text:t('actions.confirm'),onPress:submit}]);};
  const inputStyle=[styles.input,{backgroundColor:theme.surface,borderColor:theme.border,color:theme.text}]; const choice=(selected:boolean)=>[styles.choice,{backgroundColor:theme.surface,borderColor:selected?theme.primary:theme.border}];
  if(!loaded)return <SafeAreaView style={[styles.safe,{backgroundColor:theme.background}]}><Text style={{color:theme.text,padding:20}}>{t('status.loading')}</Text></SafeAreaView>;
  return <SafeAreaView style={[styles.safe,{backgroundColor:theme.background}]}><Stack.Screen options={{title:t(editId?'planning.editGoal':'planning.newGoal')}}/><KeyboardAvoidingView style={styles.safe} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
    <Text style={[styles.label,{color:theme.text}]}>{t('planning.goalName')}</Text><TextInput accessibilityLabel={t('planning.goalName')} style={inputStyle} value={name} onChangeText={setName}/>
    <Text style={[styles.label,{color:theme.text}]}>{t('planning.currency')}</Text>{SUPPORTED_CURRENCIES.map(c=><TouchableOpacity key={c} accessibilityRole="radio" accessibilityState={{checked:currency===c}} style={choice(currency===c)} onPress={()=>{setAccountId(null);setCurrency(c);}}><Text style={{color:theme.text}}>{c}</Text></TouchableOpacity>)}
    <Text style={[styles.label,{color:theme.text}]}>{t('planning.targetAmount')}</Text><TextInput accessibilityLabel={t('planning.targetAmount')} style={inputStyle} keyboardType="decimal-pad" value={target} onChangeText={setTarget}/>
    <Text style={[styles.label,{color:theme.text}]}>{t('planning.fundingAccount')}</Text><TouchableOpacity accessibilityRole="radio" accessibilityState={{checked:accountId===null}} style={choice(accountId===null)} onPress={()=>setAccountId(null)}><Text style={{color:theme.text}}>{t('planning.noLinkedAccount')} {currency&&`(${currency})`}</Text></TouchableOpacity>{accounts.map(a=><TouchableOpacity key={a.id} accessibilityRole="radio" accessibilityState={{checked:accountId===a.id}} style={choice(accountId===a.id)} onPress={()=>chooseAccount(a)}><Text style={{color:theme.text}}>{a.name} ({a.currency})</Text></TouchableOpacity>)}
    <Text style={[styles.label,{color:theme.text}]}>{t('planning.targetDateOptional')}</Text><TextInput accessibilityLabel={t('planning.targetDateOptional')} style={inputStyle} value={targetDate} onChangeText={setTargetDate} autoCapitalize="none"/>
    <Text style={[styles.label,{color:theme.text}]}>{t('planning.noteOptional')}</Text><TextInput accessibilityLabel={t('planning.noteOptional')} style={[inputStyle,styles.multiline]} value={note} onChangeText={setNote} multiline/>
    <TouchableOpacity disabled={saving} accessibilityRole="button" accessibilityState={{disabled:saving}} style={[styles.button,{backgroundColor:theme.primary},saving&&styles.disabled]} onPress={review}><Text style={styles.buttonText}>{saving?t('status.loading'):t('planning.review')}</Text></TouchableOpacity>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1},body:{padding:20,gap:10},label:{fontWeight:'600',marginTop:5},input:{borderWidth:1,borderRadius:10,padding:12,minHeight:48},multiline:{minHeight:88,textAlignVertical:'top'},choice:{padding:13,minHeight:48,borderRadius:10,borderWidth:2,justifyContent:'center'},button:{padding:15,minHeight:48,borderRadius:12,alignItems:'center',marginTop:12},buttonText:{color:'#fff',fontWeight:'700'},disabled:{opacity:.55}});
