import { NextResponse } from 'next/server'

import { isCappedSlot, isSlotEligible, slotCapacity } from '@/lib/lists/roster'
import { createServerClient } from '@/lib/supabase/server'
import { setSlotSchema } from '@/types/schemas/lists'
import type { ListRosterSettings } from '@/types/database'

interface RouteParams {
  params: Promise<{ id: string; playerId: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id, playerId } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = setSlotSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Confirm ownership and that this is actually a team list.
  const { data: list } = await supabase
    .from('lists')
    .select('id, owner_id, is_team, roster_settings')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }
  if (list.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!list.is_team) {
    return NextResponse.json(
      { error: 'Slots only apply to team lists.' },
      { status: 400 },
    )
  }

  const newSlot = parsed.data.slot

  // Starting slots enforce positional eligibility and capacity server-side —
  // the UI guards these, but the API is the real boundary (a direct PATCH must
  // not be able to put a QB in the TE slot or stack 3 RBs in a 2-RB slot).
  // Bench/IR (the non-capped slots) accept anyone and may overflow.
  if (newSlot && isCappedSlot(newSlot)) {
    const { data: pl } = await supabase
      .from('players')
      .select('position')
      .eq('id', playerId)
      .maybeSingle()
    const position = pl?.position ?? ''
    if (!isSlotEligible(newSlot, position)) {
      return NextResponse.json(
        { error: `A ${position || 'player'} can't fill the ${newSlot} slot.` },
        { status: 400 },
      )
    }

    const roster = list.roster_settings as ListRosterSettings | null
    const cap = slotCapacity(roster, newSlot)
    if (cap != null) {
      const { count } = await supabase
        .from('list_players')
        .select('id', { count: 'exact', head: true })
        .eq('list_id', id)
        .eq('slot', newSlot)
        .neq('player_id', playerId)
      if ((count ?? 0) >= cap) {
        return NextResponse.json(
          { error: `The ${newSlot} slot is full (${cap}/${cap}).` },
          { status: 400 },
        )
      }
    }
  }

  const { data: updated, error } = await supabase
    .from('list_players')
    .update({ slot: newSlot, updated_at: new Date().toISOString() })
    .eq('list_id', id)
    .eq('player_id', playerId)
    .select('player_id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  // Zero rows updated → the player isn't on this list. Surface a 404 so the
  // optimistic UI rolls back instead of trusting a phantom success.
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: 'Player is not on this list.' },
      { status: 404 },
    )
  }
  return NextResponse.json({ ok: true })
}
