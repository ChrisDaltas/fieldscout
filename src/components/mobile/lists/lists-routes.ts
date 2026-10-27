/**
 * The List view's address on the phone — `/app/lists?list=<id>` (the URL map
 * is in `lists-nav.ts`). It lives here, in a plain module, so a SERVER page
 * can build it too: the public share page (`/u/[username]/lists/[listSlug]`)
 * hands a signed-in phone to it. `lists-nav.ts` is a client module (its
 * `useListsNav` hook), and a server component can't call a function exported
 * from one.
 *
 * Someone else's list opens read-only there; your own opens with Edit.
 */

/** Where the List view was opened from, when that changes its Back. */
export type ListFrom = 'grid' | 'view'

export const listHref = (id: string, from?: ListFrom) =>
  `/app/lists?list=${encodeURIComponent(id)}${from ? `&from=${from}` : ''}`
