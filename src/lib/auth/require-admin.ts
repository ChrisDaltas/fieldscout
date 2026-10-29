import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'

import { ADMIN_NOT_FOUND_BODY } from '@/lib/admin/not-found'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Server-side admin gate for every `/api/admin/*` route (persona-post review
 * and the M8 operator console). profiles.is_admin is service-role-write-only
 * (migration 026) and, since migration 210 (F720), not readable through the
 * API roles at all: the gate asks `is_platform_operator()` (182 — SECURITY
 * DEFINER, the caller's own status only) with the user's own client.
 *
 * To anyone who is not an admin — signed out or signed in — it answers
 * **404**, never 401 / 403: the console must not reveal that it exists
 * (spec §24.4 "Where", Q96, tasks-M8 TD8; F581, L.G1.6). A profile read that
 * fails is still a loud 500 — never mistaken for "not an admin".
 */


/**
 * The one read both gates share: is the session's user a platform operator
 * (`is_platform_operator()`, reading his own `profiles.is_admin` server-side).
 * Returns the boolean, or the read's error — never folds an error into false.
 */
export async function readIsAdmin(
  supabase: SupabaseClient,
): Promise<{ isAdmin: boolean; error: null } | { isAdmin: false; error: { message: string } }> {
  const { data, error } = await supabase.rpc('is_platform_operator')
  if (error) return { isAdmin: false, error }
  return { isAdmin: data === true, error: null }
}

function notFound(): NextResponse {
  return NextResponse.json(ADMIN_NOT_FOUND_BODY, { status: 404 })
}

export type RequireAdminResult =
  | { ok: true; user: User; supabase: SupabaseClient }
  | { ok: false; response: NextResponse }

export async function requireAdminUser(): Promise<RequireAdminResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, response: notFound() }
  }

  const { isAdmin, error } = await readIsAdmin(supabase)

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    }
  }

  if (!isAdmin) {
    return { ok: false, response: notFound() }
  }

  return { ok: true, user, supabase }
}

/**
 * The same question for a server component (the `/app/admin` layout): true
 * only for a signed-in admin. A failed profile read throws — the error page,
 * never a silent "not an admin".
 */
export async function isAdminViewer(): Promise<boolean> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  const { isAdmin, error } = await readIsAdmin(supabase)
  if (error) throw new Error(`admin gate: could not read the profile — ${error.message}`)
  return isAdmin
}
