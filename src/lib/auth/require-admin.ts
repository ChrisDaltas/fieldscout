import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'

import { createServerClient } from '@/lib/supabase/server'

/**
 * Server-side admin gate for editorial surfaces (persona-post review).
 * profiles.is_admin is service-role-write-only (migration 026), so the
 * column is trustworthy when read with the user's own client.
 */

export type RequireAdminResult =
  | { ok: true; user: User; supabase: SupabaseClient }
  | { ok: false; response: NextResponse }

export async function requireAdminUser(): Promise<RequireAdminResult> {
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
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    }
  }

  if (!profile?.is_admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }

  return { ok: true, user, supabase }
}
