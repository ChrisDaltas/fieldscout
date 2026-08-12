import { redirect } from 'next/navigation'

interface ListDetailPageProps {
  params: Promise<{ listId: string }>
}

/**
 * `/app/lists/<id>` — **a redirect, not a page** (LV.7).
 *
 * Lists v2 has no standalone detail screen by design: a list opens in the right
 * panel of `/app/lists` (PROGRESS §7 gap 1, `screens/list-rail-list-view.png`).
 * But the URL is real and reachable — Home's "Recently viewed" records it,
 * search links to it, and people bookmark it — and behind the flag it had been
 * a placeholder card since LV.1.1 (LV.5's forward obligation). Leaving it as one
 * after the cutover would have made a shipped link a dead end.
 *
 * **Redirect rather than render**, because the alternative is a second detail
 * surface. Rendering the panel standalone would need its own page shell — a
 * rail-less hero, its own close/expand semantics, its own selection state — and
 * that is the two-Lists-pages state this whole task exists to end. The panel is
 * the detail view, so the URL points at the panel: `/app/lists?list=<id>`, which
 * `ListsPageV2` seeds its selection from (and pins, so a list that is neither
 * owned nor saved — one this route could always open — is not bounced to
 * whatever sits first in the rail).
 *
 * It is a server component, so the redirect happens before any HTML ships:
 * no placeholder flash, no client round-trip.
 */
export default async function ListDetailPage({ params }: ListDetailPageProps) {
  const { listId } = await params
  redirect(`/app/lists?list=${encodeURIComponent(listId)}`)
}
