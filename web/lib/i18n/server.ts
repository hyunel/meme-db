import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { isLocale, localeCookie, messages, pickLocale, type Locale, type Messages } from '.'

/** The language the visitor picked, else their browser's; reading the request renders every page per request. */
export async function getLocale(): Promise<Locale> {
  const picked = (await cookies()).get(localeCookie)?.value
  return isLocale(picked) ? picked : pickLocale((await headers()).get('accept-language'))
}

export const getMessages = async () => messages[await getLocale()]

/** generateMetadata for a page whose title is in the dictionary. */
export const pageTitle = (key: keyof Messages['titles']) => async (): Promise<Metadata> => ({ title: (await getMessages()).titles[key] })
