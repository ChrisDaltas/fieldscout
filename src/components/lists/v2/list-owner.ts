import type { ListOwner } from '@/hooks/use-list-owner'
import type { ListWithTags } from '@/hooks/use-lists'

import type { HeroOwner } from './list-detail-hero'

/**
 * Lists v2 — whose list the open panel shows, and the handle its Share link
 * carries.
 *
 * The collection the rail reads only names an owner for a **saved** list (your
 * own carry none — they are yours). A list opened by link — ⌘K, or
 * `/app/lists?list=<id>` — that is neither yours nor saved has no row there at
 * all, and the panel used to fall back to *you* as its author: the byline read
 * "@you created …" on someone else's list, the name linked to your profile,
 * and Share copied `/u/<you>/lists/<slug>`, which 404s (walk-off-1). So:
 *
 * * **saved** → the collection's owner, exactly as before;
 * * **yours** (`is_owner`, or `owner_id` is you) → you, exactly as before;
 * * **anyone else's** → the real owner, read by `useListOwner` — the same
 *   lookup the phone's list view uses. Until it answers there is **no name at
 *   all** rather than a wrong one, and Share stays disabled, so a wrong link
 *   can never be copied (prevent, don't refuse).
 */

export interface PanelOwnerInput {
  list: { is_owner: boolean; owner_id: string | null }
  summary: Pick<ListWithTags, 'owner'> | undefined
  viewer: { id: string | null | undefined; username: string | null; avatarUrl: string | null }
  /** `useListOwner`'s answer — only asked for a list that is neither yours nor saved. */
  lookup: { data: ListOwner | null | undefined; isError: boolean }
}

export interface PanelOwner {
  /** The byline's author; `null` → show no name (not known yet, or unreadable). */
  owner: HeroOwner | null
  /** The handle in Share's `/u/<handle>/lists/<slug>`; `null` → Share can't copy. */
  shareAs: string | null
  /** Why Share can't copy yet, whenever `shareAs` is `null`. */
  shareUnavailable?: string
}

export const SHARE_LINK_LOADING = 'Getting the link ready…'
export const SHARE_LINK_FAILED = 'Couldn’t load this list’s link.'

/** The viewer's own list — the server's `is_owner`, or the owner id is theirs. */
export function isViewersList(
  list: PanelOwnerInput['list'],
  viewerId: string | null | undefined,
): boolean {
  return list.is_owner || (Boolean(viewerId) && list.owner_id === viewerId)
}

/** Whether the owner has to be read: neither the viewer's list nor a saved one. */
export function needsOwnerLookup(
  list: PanelOwnerInput['list'],
  summary: PanelOwnerInput['summary'],
  viewerId: string | null | undefined,
): boolean {
  return !summary?.owner && !isViewersList(list, viewerId)
}

export function panelOwner({ list, summary, viewer, lookup }: PanelOwnerInput): PanelOwner {
  if (summary?.owner) {
    const { username, avatar_url } = summary.owner
    return { owner: { username, avatarUrl: avatar_url }, shareAs: username }
  }
  if (isViewersList(list, viewer.id)) {
    return {
      // The byline is unchanged; only Share waits for a real handle.
      owner: { username: viewer.username ?? 'you', avatarUrl: viewer.avatarUrl },
      shareAs: viewer.username,
      shareUnavailable: viewer.username ? undefined : SHARE_LINK_LOADING,
    }
  }
  const found = lookup.data?.username
  if (found) {
    return { owner: { username: found, avatarUrl: lookup.data?.avatarUrl ?? null }, shareAs: found }
  }
  // An answer without a handle (no such profile, or no username) is as final
  // as a failed read; only "no answer yet" is still loading.
  const failed = lookup.isError || lookup.data !== undefined
  return { owner: null, shareAs: null, shareUnavailable: failed ? SHARE_LINK_FAILED : SHARE_LINK_LOADING }
}

/** The public share page's address for a list. */
export function listShareLink(origin: string, username: string, slug: string): string {
  return `${origin}/u/${username}/lists/${slug}`
}
