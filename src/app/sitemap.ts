import type { MetadataRoute } from 'next'

import { createServerClient } from '@/lib/supabase/server'

/**
 * Sitemap for the public SEO surfaces (spec-ai-content-engine.md §SEO):
 * static pages, persona profiles, and published persona posts. Anon RLS
 * already scopes the queries to public content.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const supabase = await createServerClient()

  const [{ data: personas }, { data: posts }] = await Promise.all([
    supabase
      .from('ai_personas')
      .select('username')
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('persona_posts')
      .select('slug, published_at, persona:ai_personas!persona_posts_ai_persona_id_fkey!inner(username, is_active)')
      .eq('ai_personas.is_active', true)
      .order('published_at', { ascending: false })
      .limit(500),
  ])

  const entries: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/personas`, changeFrequency: 'weekly', priority: 0.8 },
  ]

  for (const p of personas ?? []) {
    entries.push({
      url: `${base}/personas/${p.username}`,
      changeFrequency: 'weekly',
      priority: 0.7,
    })
  }

  for (const post of posts ?? []) {
    const persona = Array.isArray(post.persona) ? post.persona[0] : post.persona
    if (!persona) continue
    entries.push({
      url: `${base}/personas/${(persona as { username: string }).username}/posts/${post.slug}`,
      lastModified: post.published_at ?? undefined,
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  }

  return entries
}
