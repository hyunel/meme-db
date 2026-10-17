import type { Metadata } from 'next'

// Where visitors reach the site, which share cards and canonical links spell out in full.
export const siteUrl = process.env.SITE_URL ?? 'http://localhost:3000'
// Where the Next server reaches the API; browsers go through the /api rewrite.
export const backendBase = process.env.BACKEND_BASE ?? 'http://localhost:8080'

/** The head of a public page: its share card and canonical link, kept out of search results unless index. */
export function pageMetadata({ title, description, path, image, index }: { title: string; description?: string; path: string; image?: { url: string; width?: number; height?: number }; index: boolean }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: 'MemeDB', images: image && [image] },
    twitter: image && { card: 'summary_large_image' },
    robots: index ? undefined : { index: false },
  }
}
