import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import bnCommon from '../locales/bn/common.json';
import enCommon from '../locales/en/common.json';

export const defaultNS = 'common';
export const resources = {
  bn: {
    common: bnCommon,
  },
  en: {
    common: enCommon,
  },
} as const;

export type SupportedLocale = 'bn' | 'en';
export const DEFAULT_LOCALE: SupportedLocale = 'bn';
export const FALLBACK_LOCALE: SupportedLocale = 'en';

/**
 * Returns user device language code, defaulting to Bangla ('bn').
 */
export function getDeviceLocale(): SupportedLocale {
  try {
    const locales = Localization.getLocales();
    const primary = locales[0]?.languageCode;
    if (primary === 'en') {
      return 'en';
    }
    return DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

const i18n = createInstance();

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: DEFAULT_LOCALE, // Bangla-first with English fallback (default locale: 'bn')
    fallbackLng: FALLBACK_LOCALE,
    defaultNS,
    interpolation: {
      escapeValue: false, // React Native handles escaping
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
