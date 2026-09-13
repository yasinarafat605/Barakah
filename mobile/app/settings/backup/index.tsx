import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getDatabase } from '@/src/db/client';
import { getLastSuccessfulBackup } from '@/src/services/backup/backup-service';
import { BackupHistoryRow, CURRENT_DATABASE_SCHEMA_VERSION } from '@/src/services/backup/types';

export default function RecoveryHubScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t } = useTranslation();

  const [lastBackup, setLastBackup] = useState<BackupHistoryRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadBackupStatus = useCallback(async () => {
    try {
      const db = await getDatabase();
      const latest = await getLastSuccessfulBackup(db);
      setLastBackup(latest);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    loadBackupStatus();
  }, [loadBackupStatus]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBackupStatus();
    setRefreshing(false);
  }, [loadBackupStatus]);

  const formattedDate = lastBackup
    ? new Date(lastBackup.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={[styles.headerBar, { borderBottomColor: theme.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{t('backup.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}>
        
        {/* Status Card */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.statusHeader}>
            <Ionicons
              name={lastBackup ? 'shield-checkmark' : 'shield-outline'}
              size={28}
              color={lastBackup ? theme.primary : theme.textMuted}
            />
            <View style={styles.statusTextContainer}>
              <Text style={[styles.statusTitle, { color: theme.text }]}>
                {t('backup.statusTitle')}
              </Text>
              <Text style={[styles.statusSubtitle, { color: theme.textMuted }]}>
                {lastBackup
                  ? t('backup.lastBackup', { date: formattedDate })
                  : t('backup.noBackupYet')}
              </Text>
            </View>
          </View>
          <View style={[styles.schemaBadge, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Text style={[styles.schemaBadgeText, { color: theme.textMuted }]}>
              {t('backup.schemaVersion', { version: CURRENT_DATABASE_SCHEMA_VERSION })}
            </Text>
          </View>
        </View>

        {/* Primary Actions */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            onPress={() => router.push('/settings/backup/create' as any)}
            style={[styles.actionButton, { backgroundColor: theme.primary }]}
            accessibilityRole="button"
            accessibilityLabel={t('backup.createBackup')}>
            <Ionicons name="lock-closed-outline" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>{t('backup.createBackup')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/settings/restore' as any)}
            style={[styles.actionButtonSecondary, { backgroundColor: theme.surface, borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel={t('backup.restoreBackup')}>
            <Ionicons name="refresh-outline" size={20} color={theme.primary} />
            <Text style={[styles.actionButtonSecondaryText, { color: theme.text }]}>
              {t('backup.restoreBackup')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/settings/backup/verify' as any)}
            style={[styles.actionButtonSecondary, { backgroundColor: theme.surface, borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel={t('backup.verifyBackup')}>
            <Ionicons name="checkmark-circle-outline" size={20} color={theme.primary} />
            <Text style={[styles.actionButtonSecondaryText, { color: theme.text }]}>
              {t('backup.verifyBackup')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Honest Security Notice (ADR-006 / ADR-017 / Doc 06 §0) */}
        <View style={[styles.noticeCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.noticeHeader}>
            <Ionicons name="information-circle-outline" size={20} color={theme.primary} />
            <Text style={[styles.noticeTitle, { color: theme.text }]}>
              {t('backup.honestNoticeTitle')}
            </Text>
          </View>
          <Text style={[styles.noticeBody, { color: theme.textMuted }]}>
            {t('backup.honestNoticeBody')}
          </Text>
        </View>

        {/* Lost-Device Recovery Checklist */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.checklistTitle, { color: theme.text }]}>
            {t('backup.recoveryChecklistTitle')}
          </Text>
          <View style={styles.checklistItems}>
            <Text style={[styles.checklistItem, { color: theme.textMuted }]}>{t('backup.step1')}</Text>
            <Text style={[styles.checklistItem, { color: theme.textMuted }]}>{t('backup.step2')}</Text>
            <Text style={[styles.checklistItem, { color: theme.textMuted }]}>{t('backup.step3')}</Text>
            <Text style={[styles.checklistItem, { color: theme.textMuted }]}>{t('backup.step4')}</Text>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSpacer: {
    width: 44,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  statusTextContainer: {
    flex: 1,
    gap: 4,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  statusSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  schemaBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  schemaBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionsContainer: {
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    minHeight: 48,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  actionButtonSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    minHeight: 48,
  },
  actionButtonSecondaryText: {
    fontSize: 15,
    fontWeight: '600',
  },
  noticeCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  noticeBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  checklistTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  checklistItems: {
    gap: 8,
  },
  checklistItem: {
    fontSize: 13,
    lineHeight: 19,
  },
});
