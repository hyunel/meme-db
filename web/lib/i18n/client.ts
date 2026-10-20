'use client'

import { createContext, use } from 'react'
import { htmlLang, messages, type Locale } from '.'

// Given by the root layout, which renders the page in the request's language.
export const LocaleContext = createContext<Locale>('en')

export const useLocale = () => use(LocaleContext)
export const useMessages = () => messages[useLocale()]

/** The page's language, for code outside React that runs in the browser. */
export const documentLocale = () => (Object.keys(htmlLang) as Locale[]).find((l) => htmlLang[l] === document.documentElement.lang) ?? 'en'
