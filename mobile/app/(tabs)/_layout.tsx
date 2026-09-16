import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        headerTintColor: theme.primary,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.home'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons size={24} name={focused ? 'home' : 'home-outline'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="accounts"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: t('nav.transactions'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons size={24} name={focused ? 'receipt' : 'receipt-outline'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: t('nav.plan'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons size={24} name={focused ? 'pie-chart' : 'pie-chart-outline'} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="islamic" options={{ title: t('nav.islamic'), tabBarIcon: ({ color, focused }) => (
        <Ionicons size={24} name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'} color={color} />
      ) }} />
      <Tabs.Screen name="zakat" options={{ href: null }} />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('nav.settings'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons size={24} name={focused ? 'settings' : 'settings-outline'} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
