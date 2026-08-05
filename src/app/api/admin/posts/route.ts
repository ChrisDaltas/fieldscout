import { NextResponse } from 'next/server'

import { requireAdminUser } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/posts — every persona post (drafts included) for the
 * editorial review queue. Drafts are invisible to client RLS, so reads go
 * through the service role AFTER the is_admin check.
 */
export async function GET() {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('persona_posts')
    .select(
      `id, kind, title, slug, dek, body_md, citations, status, published_at, created_at, deleted_at, list_id,
       persona:ai_personas!persona_posts_ai_persona_id_fkey(username, persona_name, avatar_url)`,
    )
    // Drafts sort before 'published' alphabetically — review queue first,
    // and a window wide enough that drafts can't fall off the end.
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ posts: data ?? [] })
}
