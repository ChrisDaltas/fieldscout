import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

/**
 * DEV ONLY: flip the signed-in user's is_pro so both sides of the Pro gate
 * are testable without Stripe. Hard-disabled outside development builds —
 * and is_pro is service-role-guarded (migration 025), so this admin-client
 * route is the only way to flip it anyway.
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: profile, error: readError } = await admin
    .from('profiles')
    .select('is_pro')
    .eq('id', user.id)
    .single()
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 })
  }

  const nextIsPro = !profile.is_pro
  const { error: writeError } = await admin
    .from('profiles')
    .update({
      is_pro: nextIsPro,
      subscription_status: nextIsPro ? 'active' : 'free',
    })
    .eq('id', user.id)
  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 500 })
  }

  return NextResponse.json({ is_pro: nextIsPro })
}
