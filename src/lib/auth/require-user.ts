import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'

import { createServerClient } from '@/lib/supabase/server'

/**
 * Server-side "must be signed in" gate. Mirrors the shape of requireProUser /
 * requireAdminUser so a route can `return gate.response` directly, but checks
 * nothing beyond authentication.
 *
 * Used by routes that are open to every account on the free-only 2026 launch
 * (CLAUDE.md "Pro tier suspended") — where any spend or abuse ceiling is a
 * per-user rate limit, not a tier check.
 */

export type RequireUserResult =
  | { ok: true; user: User; supabase: SupabaseClient }
  | { ok: false; response: NextResponse }

export async function requireUser(): Promise<RequireUserResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return { ok: true, user, supabase }
}
