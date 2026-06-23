/**
 * i18n - Internationalization service for Specorator
 *
 * Provides translation functionality for all UI strings.
 * Supports 10 locales with English as the default fallback.
 */

import * as de from './locales/de.json';
import * as en from './locales/en.json';
import * as es from './locales/es.json';
import * as fr from './locales/fr.json';
import * as ja from './locales/ja.json';
import * as ko from './locales/ko.json';
import * as pt from './locales/pt.json';
import * as ru from './locales/ru.json';
import * as zhCN from './locales/zh-CN.json';
import * as zhTW from './locales/zh-TW.json';
import type { Locale, TranslationKey } from './types';

const translations: Record<Locale, typeof en> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  ko,
  de,
  fr,
  es,
  ru,
  pt,
};

const DEFAULT_LOCALE: Locale = 'en';
let currentLocale: Locale = DEFAULT_LOCALE;

// Walk a dotted key into a locale dictionary. Returns the leaf string, or
// undefined when any segment is missing or the leaf is not a string.
function lookupTranslation(dict: typeof en, key: TranslationKey): string | undefined {
  let value: unknown = dict;

  for (const k of key.split('.')) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }

  return typeof value === 'string' ? value : undefined;
}

function interpolate(value: string, params?: Record<string, string | number>): string {
  if (!params) {
    return value;
  }

  return value.replace(/\{(\w+)\}/g, (match: string, param: string): string => {
    const replacement = params[param];
    return replacement !== undefined ? `${replacement}` : match;
  });
}

// Resolve a key against one locale's dictionary, returning the interpolated
// string or undefined when the locale has no translation for it.
function resolveForLocale(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string | undefined {
  const value = lookupTranslation(translations[locale], key);
  return value === undefined ? undefined : interpolate(value, params);
}

/**
 * Get a translation by key with optional parameters
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const resolved = resolveForLocale(currentLocale, key, params);
  if (resolved !== undefined) {
    return resolved;
  }

  if (currentLocale === DEFAULT_LOCALE) {
    return key;
  }

  return resolveForLocale(DEFAULT_LOCALE, key, params) ?? key;
}

/**
 * Set the current locale
 * @returns true if locale was set successfully, false if locale is invalid
 */
export function setLocale(locale: Locale): boolean {
  if (!translations[locale]) {
    return false;
  }
  currentLocale = locale;
  return true;
}

/**
 * Get the current locale
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Get all available locales
 */
export function getAvailableLocales(): Locale[] {
  return Object.keys(translations) as Locale[];
}

/**
 * Get display name for a locale
 */
export function getLocaleDisplayName(locale: Locale): string {
  const names: Record<Locale, string> = {
    'en': 'English',
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'ja': '日本語',
    'ko': '한국어',
    'de': 'Deutsch',
    'fr': 'Français',
    'es': 'Español',
    'ru': 'Русский',
    'pt': 'Português',
  };
  return names[locale] || locale;
}
