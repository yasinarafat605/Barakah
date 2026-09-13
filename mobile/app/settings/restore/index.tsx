import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
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
  executeRestore,
  DecryptedBackupContext,
} from '@/src/services/backup/restore-service';
import { RestoreError } from '@/src/services/backup/types';

export default function RestoreScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t } = useTranslation();

  const [selectedFile, setSelectedFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [verifiedContext, setVerifiedContext] = useState<DecryptedBackupContext | null>(null);
  const [confirmedReplacement, setConfirmedReplacement] = useState(false);

  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  const handlePickFile = async () => {
    setErrorKey(null);
    setVerifiedContext(null);
    setConfirmedReplacement(false);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const binaryStr = atob(base64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      setSelectedFile({
        name: asset.name,
        bytes,
      });
    } catch {
      setErrorKey('RESTORE_ERR_INVALID_FILE_TYPE');
    }
  };

  const handleVerifyAndPreview = async () => {
    if (!selectedFile || passphrase.length === 0 || loading) return;
    setErrorKey(null);
    setLoading(true);

    try {
      const db = await getDatabase();
      const ctx = await verifyAndPreviewBackup(db, selectedFile.bytes, passphrase);
      setVerifiedContext(ctx);
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

  const handleExecuteRestore = async () => {
    if (!verifiedContext || !confirmedReplacement || restoring) return;

    Alert.alert(
      t('restore.warningTitle'),
      t('restore.warningBody'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: t('restore.confirmRestore'),
          style: 'destructive',
          onPress: async () => {
            setErrorKey(null);
            setRestoring(true);

            try {
              const db = await getDatabase();
              await executeRestore(db, verifiedContext);
              setRestoreSuccess(true);
            } catch (err: unknown) {
              if (err instanceof RestoreError) {
                setErrorKey(err.code);
              } else {
                setErrorKey('RESTORE_ERR_PROMOTION_FAILED');
              }
            } finally {
              setRestoring(false);
            }
          },
        },
      ]
    );
  };

  const formattedDate = verifiedContext
    ? new Date(verifiedContext.preview.createdAtMs).toLocaleDateString(undefined, {
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
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          {t('restore.title')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {restoreSuccess ? (
          // Restore Success Card
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, alignItems: 'center' }]}>
            <Ionicons name="checkmark-circle" size={54} color={theme.primary} />
            <Text style={[styles.successTitle, { color: theme.text }]}>
              {t('restore.restoreSuccessTitle')}
            </Text>
            <Text style={[styles.successBody, { color: theme.textMuted }]}>
              {t('restore.restoreSuccessBody')}
            </Text>
            <TouchableOpacity
              onPress={() => router.replace('/(tabs)' as any)}
              style={[styles.actionButton, { backgroundColor: theme.primary, width: '100%' }]}
              accessibilityRole="button">
              <Text style={styles.actionButtonText}>{t('restore.returnHome')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.formContainer}>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              {t('restore.subtitle')}
            </Text>

            {errorKey && (
              <View style={[styles.errorBanner, { backgroundColor: theme.surface, borderColor: '#DC2626' }]}>
                <Ionicons name="alert-circle-outline" size={20} color="#DC2626" />
                <Text style={styles.errorBannerText}>
                  {t(`backupErrors.${errorKey}`, { defaultValue: t('backupErrors.RESTORE_ERR_AUTH_FAILED') })}
                </Text>
              </View>
            )}

            {/* Step 1: Pick File */}
            <TouchableOpacity
              onPress={handlePickFile}
              style={[styles.pickerButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
              accessibilityRole="button">
              <Ionicons name="document-attach-outline" size={24} color={theme.primary} />
              <Text style={[styles.pickerButtonText, { color: theme.text }]}>
                {selectedFile ? selectedFile.name : t('restore.selectFile')}
              </Text>
            </TouchableOpacity>

            {/* Step 2: Passphrase & Verify */}
            {selectedFile && !verifiedContext && (
              <View style={styles.passphraseSection}>
                <Text style={[styles.label, { color: theme.text }]}>
                  {t('restore.passphrasePrompt')}
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
                  onPress={handleVerifyAndPreview}
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
                    <Text style={styles.actionButtonText}>{t('restore.inspectAndPreview')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Step 3: Verified Preview & Replacement Confirmation */}
            {verifiedContext && (
              <View style={styles.previewContainer}>
                <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Text style={[styles.previewTitle, { color: theme.text }]}>
                    {t('restore.previewTitle')}
                  </Text>
                  <Text style={[styles.previewSubtitle, { color: theme.textMuted }]}>
                    {t('backup.detailsCreated', { date: formattedDate })}
                  </Text>

                  {/* Comparison Table */}
                  <View style={styles.comparisonTable}>
                    <View style={[styles.tableHeader, { borderBottomColor: theme.border }]}>
                      <Text style={[styles.tableHeaderCell, { color: theme.textMuted, flex: 2 }]}>Entity</Text>
                      <Text style={[styles.tableHeaderCell, { color: theme.textMuted, flex: 1, textAlign: 'center' }]}>Backup</Text>
                      <Text style={[styles.tableHeaderCell, { color: theme.textMuted, flex: 1, textAlign: 'center' }]}>Current</Text>
                    </View>

                    <View style={styles.tableRow}>
                      <Text style={[styles.tableCell, { color: theme.text, flex: 2 }]}>Accounts</Text>
                      <Text style={[styles.tableCell, { color: theme.text, flex: 1, textAlign: 'center' }]}>
                        {verifiedContext.preview.rowCounts.accounts}
                      </Text>
                      <Text style={[styles.tableCell, { color: theme.textMuted, flex: 1, textAlign: 'center' }]}>
                        {verifiedContext.preview.liveRowCounts.accounts}
                      </Text>
                    </View>

                    <View style={styles.tableRow}>
                      <Text style={[styles.tableCell, { color: theme.text, flex: 2 }]}>Transactions</Text>
                      <Text style={[styles.tableCell, { color: theme.text, flex: 1, textAlign: 'center' }]}>
                        {verifiedContext.preview.rowCounts.transactions}
                      </Text>
                      <Text style={[styles.tableCell, { color: theme.textMuted, flex: 1, textAlign: 'center' }]}>
                        {verifiedContext.preview.liveRowCounts.transactions}
                      </Text>
                    </View>

                    <View style={styles.tableRow}>
                      <Text style={[styles.tableCell, { color: theme.text, flex: 2 }]}>Debts</Text>
                      <Text style={[styles.tableCell, { color: theme.text, flex: 1, textAlign: 'center' }]}>
                        {verifiedContext.preview.rowCounts.debts}
                      </Text>
                      <Text style={[styles.tableCell, { color: theme.textMuted, flex: 1, textAlign: 'center' }]}>
                        {verifiedContext.preview.liveRowCounts.debts}
                      </Text>
                    </View>

                    <View style={styles.tableRow}>
                      <Text style={[styles.tableCell, { color: theme.text, flex: 2 }]}>Counterparties</Text>
                      <Text style={[styles.tableCell, { color: theme.text, flex: 1, textAlign: 'center' }]}>
                        {verifiedContext.preview.rowCounts.counterparties}
                      </Text>
                      <Text style={[styles.tableCell, { color: theme.textMuted, flex: 1, textAlign: 'center' }]}>
                        {verifiedContext.preview.liveRowCounts.counterparties}
                      </Text>
                    </View>
                  </View>

                  {/* Warning Notice */}
                  <View style={[styles.warningBox, { backgroundColor: '#FEF2F2', borderColor: '#F87171' }]}>
                    <Ionicons name="warning-outline" size={20} color="#DC2626" />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.warningTitle}>{t('restore.warningTitle')}</Text>
                      <Text style={styles.warningBody}>{t('restore.warningBody')}</Text>
                    </View>
                  </View>

                  {/* Confirmation Checkbox */}
                  <TouchableOpacity
                    onPress={() => setConfirmedReplacement((prev) => !prev)}
                    style={styles.checkboxRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: confirmedReplacement }}>
                    <Ionicons
                      name={confirmedReplacement ? 'checkbox' : 'square-outline'}
                      size={24}
                      color={confirmedReplacement ? '#DC2626' : theme.textMuted}
                    />
                    <Text style={[styles.checkboxText, { color: theme.text }]}>
                      {t('restore.confirmCheckbox')}
                    </Text>
                  </TouchableOpacity>

                  {/* Final Action Button */}
                  <TouchableOpacity
                    onPress={handleExecuteRestore}
                    disabled={!confirmedReplacement || restoring}
                    style={[
                      styles.restoreButton,
                      { backgroundColor: confirmedReplacement ? '#DC2626' : theme.border },
                    ]}
                    accessibilityRole="button">
                    {restoring ? (
                      <View style={styles.loadingRow}>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                        <Text style={styles.restoreButtonText}>{t('restore.restoring')}</Text>
                      </View>
                    ) : (
                      <Text style={styles.restoreButtonText}>{t('restore.confirmRestore')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
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
  },
  formContainer: {
    gap: 16,
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
  previewContainer: {
    marginTop: 8,
  },
  card: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    gap: 16,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  previewSubtitle: {
    fontSize: 13,
    marginTop: -8,
  },
  comparisonTable: {
    gap: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 6,
    borderBottomWidth: 1,
  },
  tableHeaderCell: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  tableCell: {
    fontSize: 14,
  },
  warningBox: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  warningTitle: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
  warningBody: {
    color: '#B91C1C',
    fontSize: 12,
    lineHeight: 18,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkboxText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  restoreButton: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 48,
    marginTop: 4,
  },
  restoreButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
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
});
