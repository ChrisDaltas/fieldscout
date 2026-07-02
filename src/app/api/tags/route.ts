import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServerClient } from '@/lib/supabase/server'

const querySchema = z.object({
  q: z.string().trim().min(1).max(50).optional(),
  systemOnly: z.coerce.boolean().optional(),
  trending: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    q: searchParams.get('q') ?? undefined,
    systemOnly: searchParams.get('systemOnly') ?? undefined,
    trending: searchParams.get('trending') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { q, systemOnly, trending, limit } = parsed.data

  const supabase = await createServerClient()

  let query = supabase
    .from('tags')
    .select('id, name, slug, is_system_tag, use_count')

  if (systemOnly) query = query.eq('is_system_tag', true)
  if (q) query = query.ilike('name', `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)

  query = trending
    ? query.order('use_count', { ascending: false })
    : query.order('name', { ascending: true })

  const { data, error } = await query.limit(limit)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ tags: data ?? [] })
}
