import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'
import { updateFolderSchema } from '@/types/schemas/lists'

interface RouteParams {
  params: Promise<{ id: string }>
}

async function ownedFolder(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  id: string,
  userId: string,
) {
  const { data } = await supabase
    .from('list_folders')
    .select('id, owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!data) return { status: 404 as const }
  if (data.owner_id !== userId) return { status: 403 as const }
  return { status: 200 as const }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = updateFolderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const owned = await ownedFolder(supabase, id, user.id)
  if (owned.status !== 200) {
    return NextResponse.json(
      { error: owned.status === 404 ? 'Folder not found' : 'Forbidden' },
      { status: owned.status },
    )
  }

  const { data, error } = await supabase
    .from('list_folders')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const owned = await ownedFolder(supabase, id, user.id)
  if (owned.status !== 200) {
    return NextResponse.json(
      { error: owned.status === 404 ? 'Folder not found' : 'Forbidden' },
      { status: owned.status },
    )
  }

  // lists.folder_id is ON DELETE SET NULL — the folder's lists survive and
  // simply become folderless again.
  const { error } = await supabase.from('list_folders').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
