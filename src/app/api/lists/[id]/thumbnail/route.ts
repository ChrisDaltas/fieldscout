import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const BUCKET = 'list-thumbnails'
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

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: list, error: fetchError } = await supabase
    .from('lists')
    .select('id, owner_id, deleted_at')
    .eq('id', id)
    .maybeSingle()
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!list || list.deleted_at) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }
  if (list.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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
    return NextResponse.json(
      { error: 'Image is too large. 5 MB max.' },
      { status: 400 },
    )
  }

  const ext = extensionFor(file.type)
  const path = `${id}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    })
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const thumbnail_url = publicUrlData.publicUrl

  const { data: updated, error: updateError } = await supabase
    .from('lists')
    .update({ thumbnail_url, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json(updated)
}
