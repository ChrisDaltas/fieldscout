import Link from 'next/link'
import { redirect } from 'next/navigation'

import { MockDraftRoom } from '@/components/draft/draft-room'
import { leagueMockRoomHref } from '@/components/draft/mock-launcher-entry'
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
 * **MP.6c: THE ROOM MOUNTS HERE.** Layer 1 (this route) landed first, then
 * layer 3 (`/api/mocks/[mockId]/…`, MP.6b), then layer 2 — the league-
 * optional spine — and `MockDraftRoom` is that spine's standalone mount: the
 * SAME `DraftRoom` component tree, given its non-draft context from the
 * practice draft instead of from a league (`room-scope.ts`; D229(5)/§4 rule
 * 12). F119's ROOM half clears with it: `/app/mocks`' *Resume* is live.
 * *View report* stays blocked — that half is MP.8's.
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

  // A LEAGUE-attached mock has a working room already, league-side, and this
  // route is not it (R521). The read above is every mock this user launched —
  // league or not, deliberately, because it is MP.5's list — so an id typed
  // here CAN resolve to one, and rendering the standalone page over it would
  // put a "the board lands here next" notice on a mock whose board is a click
  // away. Send it to the room it has. (With the leagues flag off that URL
  // redirects to `/app`, which is the same honest answer `/app/mocks` already
  // gives such a row — R519.)
  if (mock && mock.league_id !== null) {
    redirect(leagueMockRoomHref(mock.league_id, mock.id))
  }

  return (
    <div
      className={
        mock === null || failed
          ? 'mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6'
          : 'h-full min-h-0'
      }
    >
      {/* The room carries its own exits (the command bar's Exit Draft and
          every resolver state's — `room-exits.test.ts`), so this page-level
          way back renders only for the states that are NOT the room. */}
      {(failed || mock === null) && (
        <Link
          href="/app/mocks"
          className="inline-flex items-center gap-1 text-[12px] font-bold text-n-3 transition-colors duration-200 ease-linear hover:text-ink"
        >
          <Icon name="arrow-prev" size={13} />
          Practice drafts
        </Link>
      )}

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
        // MP.6c: the room itself, full-frame. The two states above stay in
        // the padded card layout because they are NOT the room — they are
        // the route being honest about a mock that is not there.
        <MockDraftRoom mockId={mock.id} />
      )}
    </div>
  )
}
