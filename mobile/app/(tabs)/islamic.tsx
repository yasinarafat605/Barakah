import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from 'react-i18next';

export default function IslamicScreen(){const theme=Colors[useColorScheme()??'light'];const {t}=useTranslation();return <SafeAreaView style={[styles.safe,{backgroundColor:theme.background}]}><View style={styles.body}><Text style={[styles.title,{color:theme.text}]}>{t('nav.islamic')}</Text><View style={[styles.card,{backgroundColor:theme.surface,borderColor:theme.border}]}><Ionicons name="shield-checkmark-outline" size={42} color={theme.primary}/><Text style={[styles.heading,{color:theme.text}]}>{t('planning.zakatReadiness')}</Text><Text style={[styles.text,{color:theme.textMuted}]}>{t('planning.notReady')}</Text><Text style={[styles.text,{color:theme.textMuted}]}>{t('planning.notReadyReason')}</Text></View></View></SafeAreaView>}
const styles=StyleSheet.create({safe:{flex:1},body:{padding:20,gap:18},title:{fontSize:28,fontWeight:'700'},card:{borderWidth:1,borderRadius:16,padding:24,gap:10,alignItems:'center'},heading:{fontSize:19,fontWeight:'700'},text:{fontSize:14,textAlign:'center',lineHeight:21}});
