import { NextResponse } from 'next/server'

import {
  countPrivateLists,
  FREE_PRIVATE_LIST_LIMIT,
  generateUniqueSlug,
} from '@/lib/lists/helpers'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Minimal read for the free-tier cap decisions. RLS makes a private list the
  // caller can't see invisible here → treated as not found. (The RPC enforces
  // the same visibility, so this is also a fast pre-check.)
  const { data: source, error: sourceError } = await supabase
    .from('lists')
    .select('title, is_private, is_team')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (sourceError) {
    return NextResponse.json({ error: sourceError.message }, { status: 500 })
  }
  if (!source) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  // Free-tier caps. Fetch is_pro once; both caps only apply to free accounts.
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_pro')
    .eq('id', user.id)
    .single()
  const isPro = profile?.is_pro ?? false

  // A duplicated private list still counts against the private-list cap. For
  // free users at the cap, fork as public instead of failing outright.
  let forcePublic = false
  if (source.is_private && !isPro) {
    const count = await countPrivateLists(supabase, user.id)
    if (count >= FREE_PRIVATE_LIST_LIMIT) {
      forcePublic = true
    }
  }

  // Duplicating a team preserves its team-ness (roster_settings + per-player
  // slots), so it counts against the free-tier one-team cap — reject rather
  // than silently stripping the roster.
  if (source.is_team && !isPro) {
    const { count } = await supabase
      .from('lists')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id)
      .eq('is_team', true)
      .is('deleted_at', null)
    if ((count ?? 0) >= 1) {
      return NextResponse.json(
        {
          error:
            'Free accounts can have one team. Upgrade to Pro for unlimited teams.',
          code: 'TEAM_LIMIT_REACHED',
        },
        { status: 403 },
      )
    }
  }

  const newTitle = `${source.title} (Copy)`
  const slug = await generateUniqueSlug(supabase, user.id, newTitle)

  // Atomic copy: the duplicate_list function creates the list and copies its
  // players (with slots) and tags in a single transaction, so a failure can
  // never leave a half-created list behind. It also derives ranking_mode and
  // its legacy boolean pair, and preserves is_team / roster_settings.
  const { data: created, error: rpcError } = await supabase
    .rpc('duplicate_list', {
      p_source_id: id,
      p_title: newTitle,
      p_slug: slug,
      p_force_public: forcePublic,
    })
    .single()

  if (rpcError || !created) {
    // P0002 = the source vanished between the pre-check and the RPC.
    const notFound = rpcError?.code === 'P0002'
    return NextResponse.json(
      { error: rpcError?.message ?? 'Could not duplicate list' },
      { status: notFound ? 404 : 500 },
    )
  }

  return NextResponse.json(created, { status: 201 })
}
