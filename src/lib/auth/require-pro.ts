import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'

import { createServerClient } from '@/lib/supabase/server'

/**
 * Server-side Pro gate for AI routes (plan §3.3). The route handler is the
 * enforcement point — never trust a client-side is_pro. Returns a ready
 * NextResponse on failure so callers can `return gate.response` directly.
 *
 * 402 Payment Required + code PRO_REQUIRED lets the client render a clean
 * upgrade prompt (distinct from the 403s used by free-tier caps).
 */

export type RequireProResult =
  | { ok: true; user: User; supabase: SupabaseClient }
  | { ok: false; response: NextResponse }

export async function requireProUser(): Promise<RequireProResult> {
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

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_pro')
    .eq('id', user.id)
    .single()

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    }
  }

  if (!profile?.is_pro) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FieldScout Pro is required for this feature.',
          code: 'PRO_REQUIRED',
        },
        { status: 402 },
      ),
    }
  }

  return { ok: true, user, supabase }
}
