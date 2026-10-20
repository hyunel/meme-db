import { zh } from './zh'
import { en } from './en'

export type { Messages } from './zh'

export const messages = { zh, en }
export type Locale = keyof typeof messages

export const htmlLang: Record<Locale, string> = { zh: 'zh-CN', en: 'en' }
// Each language by its own name, as a visitor looking for theirs reads it.
export const localeNames: Record<Locale, string> = { zh: '中文', en: 'English' }

// Holds the language a visitor picked; without it the site speaks their browser's.
export const localeCookie = 'memedb_locale'

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && Object.hasOwn(messages, v)

/** The browser's most preferred language the site speaks, else English. */
export function pickLocale(acceptLanguage: string | null): Locale {
  let best: { locale: Locale; q: number } | undefined
  for (const range of (acceptLanguage ?? '').split(',')) {
    const [tag, ...params] = range.split(';').map((s) => s.trim())
    const lang = tag.split('-')[0].toLowerCase()
    const q = Number(params.find((p) => p.startsWith('q='))?.slice(2) ?? 1)
    if (isLocale(lang) && q > (best?.q ?? 0)) best = { locale: lang, q }
  }
  return best?.locale ?? 'en'
}
