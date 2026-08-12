import { redirect } from 'next/navigation'

/**
 * `/app/lists/draft-mode` — **a redirect to `/app/lists`** (LV.7).
 *
 * The three-state draft board (`src/components/lists/draft-mode/**`, 725 lines,
 * plus `use-board-marks.ts`) is deleted by this task on Chris's earlier ruling;
 * §1's boards amendment reopened that tree for deletion only. What it did — put
 * several lists beside each other on draft night — is the design's **Side by
 * side** mode on the Lists page, and marking a player off the board is now the
 * permanent drafted checkbox on every row (plan D2).
 *
 * The URL still resolves rather than 404s: the retired Lists page linked to it
 * from a lime CTA and from every folder tile, so those links are in browser
 * histories and bookmarks. A 404 would be the dead end this cutover is supposed
 * to remove, and it is not a route users typed — it is a route the app sent them
 * to, which makes landing them on Lists the honest answer.
 *
 * It carried a `?folder=<id>` scope, which is deliberately dropped rather than
 * translated: Lists v2 scopes folders in page state, not in the URL, and
 * inventing a URL contract for it here would be inventing UI the design LAW does
 * not ask for.
 */
export default function DraftModePage() {
  redirect('/app/lists')
}
