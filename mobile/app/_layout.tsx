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
          <Stack.Screen
            name="debts/index"
            options={{
              headerShown: false,
              title: t('debts.title'),
            }}
          />
          <Stack.Screen
            name="debts/add"
            options={{
              headerShown: false,
              presentation: 'modal',
              title: t('debts.addDebt'),
            }}
          />
          <Stack.Screen
            name="debts/[id]"
            options={{
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="debts/[id]/repay"
            options={{
              headerShown: false,
              presentation: 'modal',
              title: t('debts.addRepayment'),
            }}
          />
          <Stack.Screen
            name="counterparties/index"
            options={{
              headerShown: false,
              title: t('counterparties.title'),
            }}
          />
          <Stack.Screen
            name="counterparties/[id]"
            options={{
              headerShown: false,
            }}
          />
        </Stack>
        <StatusBar style="auto" />
      </DatabaseProvider>
    </ThemeProvider>
  );
}
