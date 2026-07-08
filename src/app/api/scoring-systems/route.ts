import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireProUser } from '@/lib/auth/require-pro'
import type { Json } from '@/types/database'

// Custom scoring systems are Pro-only (business rule 6). This route is the
// enforcement point — the settings UI also disables the controls for free
// users, but the write MUST be gated server-side (a client `disabled`
// attribute can't stop a direct Supabase call). System-default presets live
// in lib/scoring and are available to everyone without touching this route.

const saveSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // 19 numeric scoring fields; validate as finite numbers without hardcoding
  // every key so the preset shape can evolve in one place (lib/scoring).
  rules: z.record(z.string(), z.number().finite()),
})

/** Upsert the signed-in Pro user's single custom scoring system. */
export async function PUT(request: Request) {
  const gate = await requireProUser()
  if (!gate.ok) return gate.response
  const { user, supabase } = gate

  const body = await request.json().catch(() => null)
  const parsed = saveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const payload = {
    name: parsed.data.name,
    rules: parsed.data.rules as Json,
    updated_at: new Date().toISOString(),
  }

  // One custom system per user on this surface: update the existing row or
  // insert the first. RLS also restricts rows to owner_id = auth.uid().
  const { data: existing } = await supabase
    .from('scoring_systems')
    .select('id')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const { data, error } = await supabase
      .from('scoring_systems')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data)
  }

  const { data, error } = await supabase
    .from('scoring_systems')
    .insert({ owner_id: user.id, ...payload })
    .select()
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
