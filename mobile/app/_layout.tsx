import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import 'react-native-reanimated';

import '@/src/lib/i18n';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DatabaseProvider } from '@/src/db/provider';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <DatabaseProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="modal"
            options={{
              presentation: 'modal',
              title: t('transactions.addTransaction'),
              headerShown: false,
            }}
          />
        </Stack>
        <StatusBar style="auto" />
      </DatabaseProvider>
    </ThemeProvider>
  );
}
