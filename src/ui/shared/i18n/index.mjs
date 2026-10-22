import shell from './en-shell.mjs';
import contract from './en-contract.mjs';
import editor from './en-editor.mjs';

export const DEFAULT_LOCALE = 'ru';
export const LOCALE_STORAGE_KEY = 'linuxarena.locale';
export const LOCALES = Object.freeze({
  ru: { label: 'Русский', tag: 'ru-RU', messages: {} },
  en: { label: 'English', tag: 'en-US', messages: { ...shell, ...contract, ...editor } },
});
let locale = DEFAULT_LOCALE;
const listeners = new Set();

export const getLocale = () => locale;
export const localeTag = () => LOCALES[locale].tag;

export function setLocale(value, { persist = true } = {}) {
  const next = Object.hasOwn(LOCALES, value) ? value : DEFAULT_LOCALE;
  if (persist) {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // The language remains usable when storage is blocked or full.
    }
  }
  if (locale === next) return;
  locale = next;
  for (const listener of listeners) listener(locale);
}

export function initializeLocale() {
  let saved;
  try {
    saved = localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    saved = DEFAULT_LOCALE;
  }
  setLocale(saved, { persist: false });
}

export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Source-message keys keep Russian as the explicit fallback, including unknown diagnostics. */
export function t(message, values = {}) {
  const catalog = LOCALES[locale].messages;
  const translated = Object.hasOwn(catalog, message) ? catalog[message] : message;
  return String(translated).replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

export function formatNumber(value, options) {
  return new Intl.NumberFormat(localeTag(), options).format(value);
}
