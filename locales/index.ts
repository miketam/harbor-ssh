import { en } from './en';
export type Locale = 'zh-CN' | 'en-US';
export const localeKey = 'harbor.locale';
export function normalizeLocale(value: unknown): Locale {
  return value === 'en-US' ? 'en-US' : 'zh-CN';
}
// Translate only application-owned messages. Never pass host names, paths,
// terminal output or server authentication prompts through this function.
export function translate(message: string, locale: Locale, ...values: (string | number)[]): string {
  const text = locale === 'en-US' ? en[message] ?? message : message;
  return text.replace(/\{(\d+)\}/g, (placeholder, index) => String(values[Number(index)] ?? placeholder));
}
