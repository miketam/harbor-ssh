import { useSyncExternalStore } from 'react';
import { localeKey, normalizeLocale, translate, type Locale } from '../locales';
function readLocale(): Locale {
  try { return normalizeLocale(localStorage.getItem(localeKey)); }
  catch { return 'zh-CN'; }
}
let locale = readLocale();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLocale(): Locale { return useSyncExternalStore(subscribe, () => locale); }
export function t(message: string, ...values: (string | number)[]): string { return translate(message, locale, ...values); }
export async function setLocale(value: Locale): Promise<void> {
  const next = normalizeLocale(value);
  // Synchronize native menu/dialog language before publishing the UI change.
  if (window.harbor) await window.harbor.setLocale(next);
  locale = next;
  document.documentElement.lang = next;
  try { localStorage.setItem(localeKey, next); }
  catch { /* Language switching remains usable without persistent storage. */ }
  listeners.forEach(listener => listener());
}
