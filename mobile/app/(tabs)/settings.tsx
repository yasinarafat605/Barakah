import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t, i18n } = useTranslation();

  const toggleLanguage = () => {
    const nextLocale = i18n.language === 'bn' ? 'en' : 'bn';
    i18n.changeLanguage(nextLocale);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>{t('screens.settings.title')}</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>{t('screens.settings.subtitle')}</Text>
        </View>

        {/* Language Selection Row */}
        <TouchableOpacity
          onPress={toggleLanguage}
          style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
          accessibilityRole="button">
          <View style={styles.rowContent}>
            <Ionicons name="globe-outline" size={22} color={theme.primary} />
            <Text style={[styles.rowLabel, { color: theme.text }]}>
              {i18n.language === 'bn' ? 'English (Switch)' : 'বাংলা (পরিবর্তন)'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    padding: 20,
    gap: 20,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
});
