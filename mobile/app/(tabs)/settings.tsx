import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useRouter } from 'expo-router';
import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BrandMark } from '@/src/components/BrandMark';

export default function SettingsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t, i18n } = useTranslation();

  const toggleLanguage = () => {
    const nextLocale = i18n.language === 'bn' ? 'en' : 'bn';
    i18n.changeLanguage(nextLocale);
  };

  const openWebsite = () => {
    Linking.openURL('https://barakah.money').catch((err) =>
      console.warn('Could not open barakah.money:', err)
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>{t('screens.settings.title')}</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>{t('screens.settings.subtitle')}</Text>
        </View>

        {/* Backup & Recovery Row */}
        <TouchableOpacity
          onPress={() => router.push('/settings/backup' as any)}
          style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel={t('backup.title')}>
          <View style={styles.rowContent}>
            <Ionicons name="shield-checkmark-outline" size={22} color={theme.primary} />
            <Text style={[styles.rowLabel, { color: theme.text }]}>
              {t('backup.title')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>

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

        {/* About Barakah Card */}
        <View style={[styles.aboutCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.aboutHeader}>
            <BrandMark
              variant="horizontal"
              height={28}
              reverse={colorScheme === 'dark'}
              accessibilityLabel="Barakah"
            />
            <Text style={[styles.versionText, { color: theme.textMuted }]}>
              {t('settings.version')}
            </Text>
          </View>
          <Text style={[styles.privacyText, { color: theme.textMuted }]}>
            {t('settings.privacyNotice')}
          </Text>
          <TouchableOpacity
            onPress={openWebsite}
            style={[styles.websiteRow, { borderTopColor: theme.border }]}
            accessibilityRole="link">
            <Text style={[styles.websiteLabel, { color: theme.primary }]}>
              {t('settings.website')}
            </Text>
            <Ionicons name="open-outline" size={16} color={theme.primary} />
          </TouchableOpacity>
        </View>
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
  aboutCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  versionText: {
    fontSize: 12,
  },
  privacyText: {
    fontSize: 13,
    lineHeight: 18,
  },
  websiteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  websiteLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
