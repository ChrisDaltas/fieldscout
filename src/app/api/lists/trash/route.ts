import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // RLS lets owners read their own deleted rows since the policy uses
  // owner_id = auth.uid() (not deleted_at). We just filter explicitly.
  const { data, error } = await supabase
    .from('lists')
    .select('*')
    .eq('owner_id', user.id)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ lists: data ?? [] })
}
