import Link from 'next/link'

import { mockProgressLabel, mockSeatCount } from '@/components/draft/mock-launcher-ops'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import type { MockDraftLists, MockDraftSummary } from '@/hooks/use-mock-drafts'
import { listMyMockDrafts } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

export const metadata = { title: 'Practice draft · FieldScout' }

interface MockRoomPageProps {
  params: Promise<{ mockId: string }>
}

/**
 * `/app/mocks/[mockId]` — the practice room's own route (MP task MP.6, LAYER
 * 1 of three; spec v2.16 §8.8; D243).
 *
 * **This route exists because the room could not live at `/app/leagues`.**
 * `(room)/leagues/layout.tsx:18` hard-redirects every `/app/leagues` URL when
 * `featureFlags.leagues` is off — *"even by direct URL"*, per its own
 * docblock — and the mock room was one of those URLs, so `mockDrafts` could
 * never reach past it (R470 / D231(3a)). A standalone mock has no league to
 * key a URL on either: it is keyed on the MOCK's id, and gated by the
 * `(room)/mocks/layout.tsx` beside this file on `mockDrafts` and nothing else
 * (E79).
 *
 * **What this page deliberately is NOT yet: the room.** MP.6 is the route and
 * only the route (D243) — `DraftRoom` is `leagueId: string` (not optional)
 * and all seventeen room verbs resolve through `.eq('league_id', leagueId)`,
 * so mounting it here today would render a URL that loads an error card and
 * 404s every pick. **MP.6b builds the standalone action surface and MP.6c the
 * league-optional spine; the room mounts here then, replacing this body.**
 * Until then this page states what the mock IS and what is missing, which is
 * the honest version of a route that exists before its contents (§4 rule 14).
 * The `/app/mocks` *Resume* control stays disabled meanwhile — F119's room
 * half is MP.6c's to discharge, and clearing it here would ship a live blue
 * button into a room that cannot pick (R515 verbatim, one task later).
 *
 * **The read is the shipped launcher-scoped one** (`listMyMockDrafts`, MP.5's
 * `GET /api/mocks`), not a new query: this task adds no server surface. That
 * also settles the unauthorized case by construction — **someone else's mock
 * and a mock that never existed are the same empty answer**, so the state
 * below can only ever say "not here", never "not yours".
 *
 * Its own way out is in the page rather than in a header: the `(room)` frame
 * is chrome-free, so a state without a link is the R340 dead end.
 */
export default async function MockRoomPage({ params }: MockRoomPageProps) {
  const { mockId } = await params

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // `src/app/app/layout.tsx` owns the auth guard above both route groups
  // (D147), so a null user here is not a case to re-handle — it is the same
  // "no mock to show" answer as an unknown id.
  let mock: MockDraftSummary | null = null
  let failed = false
  if (user) {
    const result = await listMyMockDrafts(supabase, user.id)
    if (result.status !== 200) {
      failed = true
    } else {
      const lists = result.body as unknown as MockDraftLists
      mock = [...lists.active, ...lists.recaps].find((row) => row.id === mockId) ?? null
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <Link
        href="/app/mocks"
        className="inline-flex items-center gap-1 text-[12px] font-bold text-n-3 transition-colors duration-200 ease-linear hover:text-ink"
      >
        <Icon name="arrow-prev" size={13} />
        Practice drafts
      </Link>

      {failed ? (
        <Card className="border-negative bg-negative-soft">
          <CardContent className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] font-bold" role="alert">
              Couldn&apos;t load this practice draft.
            </p>
            <Button variant="stroke" size="sm" asChild>
              <Link href="/app/mocks">Back to practice drafts</Link>
            </Button>
          </CardContent>
        </Card>
      ) : mock === null ? (
        // Not yours and never existed are ONE state on purpose (see the
        // docblock): RLS + the launcher-scoped filter answer both the same
        // way, and a page that could tell them apart would be leaking.
        <Card>
          <CardContent className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <Icon name="rocket" size={18} className="text-n-3" />
            <p className="text-h5 text-ink">This practice draft isn&apos;t here</p>
            <p className="max-w-md text-[13px] font-medium text-n-3">
              It may have been deleted, or expired after 72 hours paused.
            </p>
            <div className="mt-1">
              <Button variant="blue" size="sm" shadow asChild>
                <Link href="/app/mocks">Back to practice drafts</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2.5 p-4">
              <Badge
                variant={
                  mock.status === 'complete'
                    ? 'stroke'
                    : mock.status === 'paused'
                      ? 'yellow'
                      : 'green'
                }
              >
                {mock.status === 'complete'
                  ? mock.league_id === null
                    ? 'Report'
                    : 'Recap'
                  : mock.status === 'paused'
                    ? 'Paused'
                    : 'Live'}
              </Badge>
              <div className="min-w-0">
                <p className="truncate text-h5 leading-tight text-ink">Practice draft</p>
                <p className="truncate text-[11px] font-semibold text-n-3">
                  {mock.status === 'complete'
                    ? 'Finished'
                    : mockProgressLabel(mock, mockSeatCount(mock, null))}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col items-start gap-2 p-4">
              <p className="text-[13px] font-bold text-ink">The draft board lands here next</p>
              <p className="text-[13px] font-medium text-n-3">
                Picking, bidding and the board open in the next release.
              </p>
              <Button variant="stroke" size="sm" asChild>
                <Link href="/app/mocks">Back to practice drafts</Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
