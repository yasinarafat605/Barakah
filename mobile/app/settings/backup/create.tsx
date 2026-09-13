import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getDatabase } from '@/src/db/client';
import {
  createEncryptedBackup,
  shareBackupFile,
  BackupResult,
} from '@/src/services/backup/backup-service';
import { MIN_PASSPHRASE_LENGTH, BackupError } from '@/src/services/backup/types';

export default function CreateBackupScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t } = useTranslation();

  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);

  // Neutral passphrase strength calculator
  const strengthLevel = useMemo<'weak' | 'good' | 'strong'>(() => {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) return 'weak';
    let score = 0;
    if (passphrase.length >= 14) score++;
    if (passphrase.length >= 18) score++;
    if (/[A-Z]/.test(passphrase) && /[a-z]/.test(passphrase)) score++;
    if (/[0-9]/.test(passphrase)) score++;
    if (/[^A-Za-z0-9]/.test(passphrase)) score++;

    if (score >= 4) return 'strong';
    if (score >= 2) return 'good';
    return 'weak';
  }, [passphrase]);

  const isWeb = Platform.OS === 'web';

  const canExport =
    !isWeb &&
    passphrase.length >= MIN_PASSPHRASE_LENGTH &&
    passphrase === confirmPassphrase &&
    acknowledged &&
    !loading;

  const handleExport = async () => {
    if (!canExport) return;
    setErrorKey(null);
    setLoading(true);

    try {
      const db = await getDatabase();
      const result = await createEncryptedBackup(db, passphrase, confirmPassphrase);
      setBackupResult(result);
    } catch (err: unknown) {
      if (err instanceof BackupError) {
        setErrorKey(err.code);
      } else {
        setErrorKey('BACKUP_ERR_EXPORT_FAILED');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    if (!backupResult?.filePath) return;
    try {
      const db = await getDatabase();
      await shareBackupFile(db, backupResult.historyId, backupResult.filePath);
    } catch {
      // User cancellation handled quietly
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}>
        <View style={[styles.headerBar, { borderBottomColor: theme.border }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('actions.back')}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {t('backup.createTitle')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {backupResult ? (
            // Success Result View
            <View style={[styles.successCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Ionicons name="checkmark-circle" size={48} color={theme.primary} />
              <Text style={[styles.successTitle, { color: theme.text }]}>
                {t('backup.exportSuccessTitle')}
              </Text>
              <Text style={[styles.successBody, { color: theme.textMuted }]}>
                {t('backup.exportSuccessBody')}
              </Text>

              <View style={[styles.detailsBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
                <Text style={[styles.detailText, { color: theme.text }]}>
                  {t('backup.fileDetails', {
                    name: backupResult.fileName,
                    size: (backupResult.fileSizeBytes / 1024).toFixed(1),
                  })}
                </Text>
                <Text style={[styles.detailText, { color: theme.textMuted }]}>
                  {t('backup.recordsSummary', { count: backupResult.recordCount })}
                </Text>
              </View>

              <TouchableOpacity
                onPress={handleShare}
                style={[styles.shareButton, { backgroundColor: theme.primary }]}
                accessibilityRole="button"
                accessibilityLabel={t('backup.shareFile')}>
                <Ionicons name="share-outline" size={20} color="#FFFFFF" />
                <Text style={styles.shareButtonText}>{t('backup.shareFile')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.back()}
                style={[styles.doneButton, { borderColor: theme.border }]}
                accessibilityRole="button">
                <Text style={[styles.doneButtonText, { color: theme.text }]}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Form View
            <View style={styles.formContainer}>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                {t('backup.createSubtitle')}
              </Text>

              {errorKey && (
                <View style={[styles.errorBanner, { backgroundColor: theme.surface, borderColor: '#DC2626' }]}>
                  <Ionicons name="alert-circle-outline" size={20} color="#DC2626" />
                  <Text style={styles.errorBannerText}>
                    {t(`backupErrors.${errorKey}`, { defaultValue: t('backupErrors.BACKUP_ERR_EXPORT_FAILED') })}
                  </Text>
                </View>
              )}

              {/* Passphrase Input */}
              <View style={styles.inputGroup}>
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
                    accessibilityRole="button"
                    accessibilityLabel={showPassphrase ? t('backup.hidePassphrase') : t('backup.showPassphrase')}>
                    <Ionicons
                      name={showPassphrase ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={theme.textMuted}
                    />
                  </TouchableOpacity>
                </View>

                {/* Neutral Strength Guidance */}
                {passphrase.length > 0 && (
                  <View style={styles.strengthContainer}>
                    <Text style={[styles.strengthLabel, { color: theme.textMuted }]}>
                      {t('backup.strength')}:{' '}
                      <Text
                        style={{
                          fontWeight: '600',
                          color:
                            strengthLevel === 'strong'
                              ? '#15803D'
                              : strengthLevel === 'good'
                              ? '#087A62'
                              : '#D97706',
                        }}>
                        {strengthLevel === 'strong'
                          ? t('backup.strengthStrong')
                          : strengthLevel === 'good'
                          ? t('backup.strengthGood')
                          : t('backup.strengthWeak')}
                      </Text>
                    </Text>
                  </View>
                )}
              </View>

              {/* Confirm Passphrase Input */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.text }]}>
                  {t('backup.passphraseConfirmPrompt')}
                </Text>
                <View style={[styles.inputWrapper, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <TextInput
                    style={[styles.input, { color: theme.text }]}
                    secureTextEntry={!showPassphrase}
                    value={confirmPassphrase}
                    onChangeText={setConfirmPassphrase}
                    placeholder={t('backup.passphraseConfirmPlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                {confirmPassphrase.length > 0 && passphrase !== confirmPassphrase && (
                  <Text style={styles.mismatchText}>{t('backup.passphraseMismatch')}</Text>
                )}
              </View>

              {/* Acknowledgment Checkbox */}
              <TouchableOpacity
                onPress={() => setAcknowledged((prev) => !prev)}
                style={styles.checkboxRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acknowledged }}>
                <Ionicons
                  name={acknowledged ? 'checkbox' : 'square-outline'}
                  size={24}
                  color={acknowledged ? theme.primary : theme.textMuted}
                />
                <Text style={[styles.checkboxText, { color: theme.text }]}>
                  {t('backup.ackNotice')}
                </Text>
              </TouchableOpacity>

              {/* Action Button */}
              <TouchableOpacity
                onPress={handleExport}
                disabled={!canExport}
                style={[
                  styles.exportButton,
                  { backgroundColor: canExport ? theme.primary : theme.border },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('backup.exportButton')}>
                {loading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.exportButtonText}>{t('backup.creating')}</Text>
                  </View>
                ) : (
                  <Text style={styles.exportButtonText}>{t('backup.exportButton')}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardView: {
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
  },
  formContainer: {
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
  inputGroup: {
    gap: 8,
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
  strengthContainer: {
    marginTop: 4,
  },
  strengthLabel: {
    fontSize: 12,
  },
  mismatchText: {
    color: '#DC2626',
    fontSize: 12,
    marginTop: 4,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 4,
  },
  checkboxText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  exportButton: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 48,
    marginTop: 12,
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successCard: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: 16,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  successBody: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  detailsBox: {
    width: '100%',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
  },
  detailText: {
    fontSize: 13,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    minHeight: 48,
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  doneButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 44,
  },
  doneButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
