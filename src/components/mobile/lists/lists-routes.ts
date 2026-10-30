/**
 * The List view's address on the phone — `/app/lists?list=<id>` (the URL map
 * is in `lists-nav.ts`). It lives here, in a plain module with no imports, so
 * a SERVER page can build it too (the public share page's phone handoff,
 * `/u/[username]/lists/[listSlug]`) and the middleware can read it back.
 * `lists-nav.ts` is a client module (its `useListsNav` hook), and a server
 * component can't call a function exported from one.
 *
 * Your own list opens there with Edit. Someone else's opens there read-only
 * while Community is off, and on Community's list page while it is on
 * (`inAppListHref`, community-ops).
 */

/** Where the List view was opened from, when that changes its Back. */
export type ListFrom = 'grid' | 'view'

export const listHref = (id: string, from?: ListFrom) =>
  `/app/lists?list=${encodeURIComponent(id)}${from ? `&from=${from}` : ''}`

/**
 * The flag that opens a list's comments on arrival: `comments=1` beside
 * `?list=`. "@x commented on your list" (`list_comment`, migration 213) links
 * here, so the tap lands where the comment is — on the phone the List view
 * with its Comments sheet open, on desktop the Lists panel on its Comments
 * tab. The screen drops the flag once it has opened them
 * (`withoutCommentsFlag`), so Back and a reload show the list as usual.
 */
export const LIST_COMMENTS_PARAM = 'comments'

/** Your list, opened on its comments (`LIST_COMMENTS_PARAM`). */
export const listCommentsHref = (id: string) => `${listHref(id)}&${LIST_COMMENTS_PARAM}=1`

/** An address (path + query) with the comments flag taken out, the rest
 *  kept as it was. */
export function withoutCommentsFlag(href: string): string {
  const at = href.indexOf('?')
  if (at === -1) return href
  const search = new URLSearchParams(href.slice(at + 1))
  if (!search.has(LIST_COMMENTS_PARAM)) return href
  search.delete(LIST_COMMENTS_PARAM)
  const rest = search.toString()
  return `${href.slice(0, at)}${rest ? `?${rest}` : ''}`
}

/**
 * The phone screens that open one list from `?list=<id>`: the List view
 * (`listHref`) and Community's list page, over the feed or the Latest page
 * (`communityDetailHref` — pinned against these in `public-list-phone.test`).
 */
const PHONE_LIST_PATHS: ReadonlySet<string> = new Set(['/app/lists', '/app/explore', '/app/explore/latest'])

/**
 * The list a phone address opens (`/app/lists?list=<id>`,
 * `/app/explore?list=<id>`), or `null` for any other address. Those
 * addresses get shared from a phone's address bar, so the middleware sends a
 * signed-out visitor to the list's public page instead of the sign-in page.
 */
export function phoneListIdOf(pathname: string, search: URLSearchParams): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  if (!PHONE_LIST_PATHS.has(path)) return null
  const id = search.get('list')
  return id ? id : null
}
