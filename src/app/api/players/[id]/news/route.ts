import { NextResponse } from 'next/server'
import { z } from 'zod'

import { NEWS_PAGE_SIZE, type PlayerNewsPage } from '@/lib/news/types'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const querySchema = z.strictObject({ page: z.coerce.number().int().min(0).max(100).optional() })

/** GET /api/players/[id]/news?page=N — the player view's News section (F575,
 *  D550): newest first, NEWS_PAGE_SIZE per page. Login required; read under
 *  the viewer's session (RLS: authenticated SELECT). A failed read is a 500,
 *  never an empty list. */
export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params
  if (id.length === 0 || id.length > 64) return NextResponse.json({ error: 'Player not found' }, { status: 404 })
  const query: Record<string, string> = {}
  for (const [k, v] of new URL(request.url).searchParams.entries()) if (v !== '') query[k] = v
  const parsed = querySchema.safeParse(query)
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 })
  const page = parsed.data.page ?? 0

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const from = page * NEWS_PAGE_SIZE
  const { data, error } = await supabase
    .from('player_news')
    .select('id, headline, source_label, url, published_at, player_news_players!inner(player_id)')
    .eq('player_news_players.player_id', id)
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    // One extra row tells us whether another page exists.
    .range(from, from + NEWS_PAGE_SIZE)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  const body: PlayerNewsPage = {
    items: rows.slice(0, NEWS_PAGE_SIZE).map((r) => ({
      id: r.id,
      headline: r.headline,
      source: r.source_label,
      url: r.url,
      published_at: r.published_at,
    })),
    nextPage: rows.length > NEWS_PAGE_SIZE ? page + 1 : null,
  }
  return NextResponse.json(body)
}
