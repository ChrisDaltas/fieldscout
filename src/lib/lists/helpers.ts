import type { SupabaseClient } from '@supabase/supabase-js'

export const FREE_PRIVATE_LIST_LIMIT = 1

/**
 * Best-effort: notify everyone who has pinned (favorited) `listId` that the
 * owner updated it. Coalesced + deduped in the DB function. Never throws —
 * a notification failure must not fail the underlying mutation.
 */
export async function notifyListFollowers(
  supabase: SupabaseClient,
  listId: string,
  actorId: string,
): Promise<void> {
  try {
    await supabase.rpc('notify_list_followers', {
      p_list_id: listId,
      p_actor: actorId,
    })
  } catch {
    // Swallow — notifications are non-critical.
  }
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'list'
}

export function tagSlug(name: string): string {
  return slugify(name)
}

/**
 * Generate a unique slug for a user by suffixing -2, -3, … if a slug is taken.
 * Big Board reserves the literal slug 'big-board' — never collide.
 */
export async function generateUniqueSlug(
  supabase: SupabaseClient,
  ownerId: string,
  desired: string,
): Promise<string> {
  const base = slugify(desired)
  if (base === 'big-board') return generateUniqueSlug(supabase, ownerId, `${desired}-list`)

  const { data } = await supabase
    .from('lists')
    .select('slug')
    .eq('owner_id', ownerId)
    .like('slug', `${base}%`)

  const taken = new Set((data ?? []).map((r) => r.slug as string))
  if (!taken.has(base)) return base

  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/**
 * Resolve tag names to existing/created tag IDs. System tags exist already;
 * unknown names become user-owned custom tags.
 */
export async function resolveTagIds(
  supabase: SupabaseClient,
  authorId: string,
  names: string[],
): Promise<string[]> {
  const trimmed = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)))
  if (trimmed.length === 0) return []

  const slugs = trimmed.map(tagSlug)
  const { data: existing, error: existingError } = await supabase
    .from('tags')
    .select('id, slug')
    .in('slug', slugs)
  if (existingError) throw existingError

  const bySlug = new Map((existing ?? []).map((t) => [t.slug as string, t.id as string]))

  const toCreate = trimmed.filter((name) => !bySlug.has(tagSlug(name)))
  if (toCreate.length > 0) {
    const inserts = toCreate.map((name) => ({
      name,
      slug: tagSlug(name),
      is_system_tag: false,
      created_by: authorId,
    }))
    const { data: created, error: createError } = await supabase
      .from('tags')
      .insert(inserts)
      .select('id, slug')
    if (createError) throw createError
    for (const t of created ?? []) bySlug.set(t.slug as string, t.id as string)
  }

  return slugs.map((s) => bySlug.get(s)).filter((id): id is string => Boolean(id))
}

/**
 * Replace tags on a list (delete all, re-insert). Caller must ensure ownership.
 */
export async function replaceTagsForList(
  supabase: SupabaseClient,
  listId: string,
  tagIds: string[],
): Promise<void> {
  const { error: delError } = await supabase
    .from('list_tags')
    .delete()
    .eq('list_id', listId)
  if (delError) throw delError

  if (tagIds.length === 0) return

  const inserts = tagIds.map((tag_id) => ({ list_id: listId, tag_id }))
  const { error: insError } = await supabase.from('list_tags').insert(inserts)
  if (insError) throw insError
}

/**
 * Count a user's existing private (non-deleted) lists. Used to enforce the
 * free-tier limit of 1 private list before allowing is_private = TRUE.
 */
export async function countPrivateLists(
  supabase: SupabaseClient,
  ownerId: string,
  excludeListId?: string,
): Promise<number> {
  let query = supabase
    .from('lists')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('is_private', true)
    .is('deleted_at', null)

  if (excludeListId) query = query.neq('id', excludeListId)

  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

/**
 * Returns the next position value for a list (MAX(position) + 1, or 1 if empty).
 */
export async function nextPositionForList(
  supabase: SupabaseClient,
  listId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('list_players')
    .select('position')
    .eq('list_id', listId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return ((data?.position as number | undefined) ?? 0) + 1
}
