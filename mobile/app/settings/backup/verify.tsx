import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getDatabase } from '@/src/db/client';
import {
  verifyAndPreviewBackup,
  DecryptedBackupContext,
} from '@/src/services/backup/restore-service';
import { recordVerifiedExternalBackup } from '@/src/services/backup/backup-service';
import { computeSha256Hex } from '@/src/services/backup/crypto';
import { RestoreError, MAX_BACKUP_FILE_SIZE_BYTES } from '@/src/services/backup/types';
import { base64ToUint8Array } from '@/src/services/backup/safety';

export default function VerifyBackupScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t } = useTranslation();

  const [selectedFile, setSelectedFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [verificationResult, setVerificationResult] = useState<DecryptedBackupContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const handlePickFile = async () => {
    setErrorKey(null);
    setVerificationResult(null);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];

      if (asset.size && asset.size > MAX_BACKUP_FILE_SIZE_BYTES) {
        setErrorKey('RESTORE_ERR_FILE_TOO_LARGE');
        return;
      }

      const fileInfo = await FileSystem.getInfoAsync(asset.uri);
      if (fileInfo.exists && fileInfo.size && fileInfo.size > MAX_BACKUP_FILE_SIZE_BYTES) {
        setErrorKey('RESTORE_ERR_FILE_TOO_LARGE');
        return;
      }

      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const bytes = base64ToUint8Array(base64);

      setSelectedFile({
        name: asset.name,
        bytes,
      });
    } catch {
      setErrorKey('RESTORE_ERR_INVALID_FILE_TYPE');
    }
  };

  const handleVerify = async () => {
    if (!selectedFile || passphrase.length === 0 || loading) return;
    setErrorKey(null);
    setLoading(true);

    try {
      const db = await getDatabase();
      const ctx = await verifyAndPreviewBackup(db, selectedFile.bytes, passphrase);
      setVerificationResult(ctx);

      // Promote backup history record to 'verified_external_copy'
      const fileChecksum = computeSha256Hex(selectedFile.bytes);
      await recordVerifiedExternalBackup(db, fileChecksum);
    } catch (err: unknown) {
      if (err instanceof RestoreError) {
        setErrorKey(err.code);
      } else {
        setErrorKey('RESTORE_ERR_AUTH_FAILED');
      }
    } finally {
      setLoading(false);
    }
  };

  const formattedDate = verificationResult
    ? new Date(verificationResult.preview.createdAtMs).toLocaleDateString(undefined, {
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
          accessibilityLabel={t('actions.back')}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          {t('backup.verifyTitle')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          {t('backup.verifySubtitle')}
        </Text>

        {errorKey && (
          <View style={[styles.errorBanner, { backgroundColor: theme.surface, borderColor: '#DC2626' }]}>
            <Ionicons name="alert-circle-outline" size={20} color="#DC2626" />
            <Text style={styles.errorBannerText}>
              {t(`backupErrors.${errorKey}`, { defaultValue: t('backupErrors.RESTORE_ERR_AUTH_FAILED') })}
            </Text>
          </View>
        )}

        {/* File Picker Button */}
        <TouchableOpacity
          onPress={handlePickFile}
          style={[styles.pickerButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
          accessibilityRole="button">
          <Ionicons name="document-attach-outline" size={24} color={theme.primary} />
          <Text style={[styles.pickerButtonText, { color: theme.text }]}>
            {selectedFile ? selectedFile.name : t('backup.selectFile')}
          </Text>
        </TouchableOpacity>

        {selectedFile && !verificationResult && (
          <View style={styles.passphraseSection}>
            <Text style={[styles.label, { color: theme.text }]}>
              {t('backup.passphrasePrompt')}
            </Text>
            <View style={[styles.inputWrapper, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <TextInput
                style={[styles.input, { color: theme.text }]}
                secureTextEntry={!showPassphrase}
                value={passphrase}
                onChangeText={setPassphrase}
                placeholder={t('backup.passphrasePlaceholder')}
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setShowPassphrase((prev) => !prev)}
                style={styles.toggleButton}
                accessibilityRole="button">
                <Ionicons
                  name={showPassphrase ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={theme.textMuted}
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={handleVerify}
              disabled={passphrase.length === 0 || loading}
              style={[
                styles.actionButton,
                { backgroundColor: passphrase.length > 0 ? theme.primary : theme.border },
              ]}
              accessibilityRole="button">
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.actionButtonText}>{t('backup.verifying')}</Text>
                </View>
              ) : (
                <Text style={styles.actionButtonText}>{t('backup.verifyButton')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {verificationResult && (
          <View style={[styles.resultCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="checkmark-circle" size={44} color={theme.primary} />
            <Text style={[styles.resultTitle, { color: theme.text }]}>
              {t('backup.verifySuccessTitle')}
            </Text>
            <Text style={[styles.resultBody, { color: theme.textMuted }]}>
              {t('backup.verifySuccessBody')}
            </Text>

            <View style={[styles.previewBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Text style={[styles.previewItem, { color: theme.text }]}>
                {t('backup.detailsCreated', { date: formattedDate })}
              </Text>
              <Text style={[styles.previewItem, { color: theme.text }]}>
                {t('backup.detailsAccounts', { count: verificationResult.preview.rowCounts.accounts })}
              </Text>
              <Text style={[styles.previewItem, { color: theme.text }]}>
                {t('backup.detailsTransactions', { count: verificationResult.preview.rowCounts.transactions })}
              </Text>
              <Text style={[styles.previewItem, { color: theme.text }]}>
                {t('backup.detailsDebts', { count: verificationResult.preview.rowCounts.debts })}
              </Text>
              <Text style={[styles.previewItem, { color: theme.text }]}>
                {t('backup.detailsCounterparties', { count: verificationResult.preview.rowCounts.counterparties })}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => router.back()}
              style={[styles.doneButton, { backgroundColor: theme.primary }]}
              accessibilityRole="button">
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
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
    padding: 20,
    gap: 20,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  errorBannerText: {
    color: '#DC2626',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    minHeight: 52,
  },
  pickerButtonText: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  passphraseSection: {
    gap: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 12,
  },
  toggleButton: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButton: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 48,
    marginTop: 8,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resultCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: 14,
  },
  resultTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  resultBody: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  previewBox: {
    width: '100%',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  previewItem: {
    fontSize: 13,
  },
  doneButton: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 44,
    marginTop: 8,
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
