import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServerClient } from '@/lib/supabase/server'

/**
 * League profile — rename + avatar (migration 064). All writes go through the
 * update_league_profile RPC (commissioner-only in-body, 054 server-
 * authoritative); the avatar binary lands in the `league-avatars` bucket
 * (public read, commissioner-gated writes via storage RLS), mirroring the
 * user-avatar flow (/api/profile/avatar, migration 014).
 *
 *   PATCH  { name }        → rename
 *   POST   multipart file  → upload avatar, set leagues.avatar_url
 *   DELETE                 → clear leagues.avatar_url
 */

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()
const renameSchema = z.object({ name: z.string().trim().min(1).max(100) })

const BUCKET = 'league-avatars'
const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

function extensionFor(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'jpg'
}

/** Map update_league_profile RPC errors to friendly HTTP results. */
function mapRpcError(error: { code?: string; message: string }): NextResponse {
  if (error.code === '42501') {
    return NextResponse.json(
      { error: 'Only the commissioner can change the league profile.' },
      { status: 403 },
    )
  }
  if (error.message.includes('not found')) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  const fieldMatch = error.message.match(/^(?:.*: )?name: (.+)$/)
  if (fieldMatch) {
    return NextResponse.json({ error: fieldMatch[1] }, { status: 400 })
  }
  return NextResponse.json({ error: error.message }, { status: 500 })
}

async function authedClient(id: string) {
  if (!idSchema.safeParse(id).success) {
    return { response: NextResponse.json({ error: 'League not found' }, { status: 404 }) }
  }
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { supabase }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  const auth = await authedClient(id)
  if ('response' in auth) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = renameSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'League name must be between 1 and 100 characters.' },
      { status: 400 },
    )
  }

  const { error } = await auth.supabase.rpc('update_league_profile', {
    p_league_id: id,
    p_name: parsed.data.name,
  })
  if (error) return mapRpcError(error)

  return NextResponse.json({ ok: true, name: parsed.data.name })
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params
  const auth = await authedClient(id)
  if ('response' in auth) return auth.response
  const { supabase } = auth

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Use PNG, JPEG, WebP, or GIF.' },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image is too large. 5 MB max.' }, { status: 400 })
  }

  const path = `${id}/${Date.now()}.${extensionFor(file.type)}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  })
  if (uploadError) {
    // Storage RLS refuses non-commissioners before the RPC is ever reached.
    const denied = uploadError.message.toLowerCase().includes('security policy')
    return NextResponse.json(
      {
        error: denied
          ? 'Only the commissioner can change the league profile.'
          : uploadError.message,
      },
      { status: denied ? 403 : 500 },
    )
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const avatar_url = publicUrlData.publicUrl

  const { error } = await supabase.rpc('update_league_profile', {
    p_league_id: id,
    p_avatar_url: avatar_url,
  })
  if (error) {
    // Don't leave an orphaned object behind a failed column write.
    await supabase.storage.from(BUCKET).remove([path])
    return mapRpcError(error)
  }

  return NextResponse.json({ ok: true, avatar_url })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const auth = await authedClient(id)
  if ('response' in auth) return auth.response

  const { error } = await auth.supabase.rpc('update_league_profile', {
    p_league_id: id,
    p_clear_avatar: true,
  })
  if (error) return mapRpcError(error)

  return NextResponse.json({ ok: true, avatar_url: null })
}
