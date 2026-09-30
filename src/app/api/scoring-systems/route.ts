import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireProUser } from '@/lib/auth/require-pro'
import { savePersonalScoringSystem } from '@/lib/scoring/personal-scoring-system'

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

  // The PERSONAL row only — never a league fork the user also owns (R1335,
  // F523; the one test lives in personal-scoring-system.ts).
  const result = await savePersonalScoringSystem(supabase, user.id, {
    name: parsed.data.name,
    rules: parsed.data.rules,
    updatedAt: new Date().toISOString(),
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.row, { status: result.status })
}
