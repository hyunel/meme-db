import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: ['/admin', '/library', '/favorites', '/shares', '/settings', '/search', '/login', '/register'] },
  }
}
