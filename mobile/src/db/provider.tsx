import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useTranslation } from 'react-i18next';

import { getDatabase } from './client';
import { runMigrations } from './migrations';
import { Colors } from '../constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BrandMark } from '../components/BrandMark';

// Hold native splash screen auto-hide at module load time
SplashScreen.preventAutoHideAsync().catch(() => {
  /* safe to ignore during hot reload or web refresh */
});

interface DatabaseContextValue {
  isReady: boolean;
  retry: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextValue>({
  isReady: false,
  retry: async () => {},
});

export function useDatabaseContext(): DatabaseContextValue {
  return useContext(DatabaseContext);
}

// Module-level singleton promise to guarantee non-concurrent initialization across mounts/renders
let activeInitPromise: Promise<void> | null = null;

export async function initializeDatabaseSingleton(): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && !window.crossOriginIsolated) {
    console.warn(
      '[Barakah Database] Web environment detected without cross-origin isolation (window.crossOriginIsolated = false). ' +
      'For SQLite WASM and OPFS high-performance persistence, configure web host headers:\n' +
      '  Cross-Origin-Opener-Policy: same-origin\n' +
      '  Cross-Origin-Embedder-Policy: require-corp'
    );
  }

  if (!activeInitPromise) {
    activeInitPromise = (async () => {
      const db = await getDatabase();
      await runMigrations(db);
    })();
  }
  return activeInitPromise;
}

export function resetDatabaseSingleton(): void {
  activeInitPromise = null;
}

interface DatabaseProviderProps {
  children: React.ReactNode;
}

export function DatabaseProvider({ children }: DatabaseProviderProps) {
  const [status, setStatus] = useState<'initializing' | 'ready' | 'error'>('initializing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t } = useTranslation();

  const runInit = useCallback(async () => {
    setStatus('initializing');
    setErrorMessage(null);

    try {
      await initializeDatabaseSingleton();
      setStatus('ready');
      // Hide native splash once database is ready
      try {
        await SplashScreen.hideAsync();
      } catch {
        // Safe to ignore splash screen hide errors
      }
    } catch (err: unknown) {
      // Clear singleton on failure so retry can cleanly execute
      resetDatabaseSingleton();

      if (__DEV__) {
        console.error('[Barakah DB Init Error]:', err);
      }

      const safeMessage = t('database.initError');
      setErrorMessage(safeMessage);
      setStatus('error');

      // Ensure splash is dismissed so error screen is visible
      try {
        await SplashScreen.hideAsync();
      } catch {
        // Safe to ignore
      }
    }
  }, [t]);

  useEffect(() => {
    runInit();
  }, [runInit]);

  const handleRetry = useCallback(async () => {
    await runInit();
  }, [runInit]);

  const contextValue = useMemo(() => ({
    isReady: status === 'ready',
    retry: handleRetry,
  }), [status, handleRetry]);

  if (status === 'initializing') {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <BrandMark width={180} height={52} variant="horizontal" reverse={colorScheme === 'dark'} />
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.textMuted }]}>
            {t('database.initializing')}
          </Text>
        </View>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <BrandMark width={80} height={80} variant="symbol" reverse={colorScheme === 'dark'} />
        <Text style={[styles.errorTitle, { color: theme.text }]}>
          {t('database.errorTitle')}
        </Text>
        <Text style={[styles.errorSubtitle, { color: theme.textMuted }]}>
          {errorMessage || t('database.initError')}
        </Text>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: theme.primary }]}
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel={t('database.retry')}>
          <Text style={styles.retryButtonText}>{t('database.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <DatabaseContext.Provider value={contextValue}>
      {children}
    </DatabaseContext.Provider>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  loadingBox: {
    alignItems: 'center',
    marginTop: 24,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 12,
  },
  errorSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
