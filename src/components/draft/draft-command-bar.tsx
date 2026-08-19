'use client'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  RECONNECTING_COPY,
  RECONNECTING_COPY_COMPACT,
  ReconnectingBanner,
} from '@/components/leagues/status-banners'
import { toast } from '@/hooks/use-toast'

import { commandBarModel, exitDraftCopy, type CommandBarInput } from './command-bar-ops'
import { DraftOptionsMenu } from './draft-options-menu'
import { type DraftOptionsSectionId } from './draft-options-ops'

interface DraftCommandBarProps {
  leagueId: string
  /** The raw pieces of the D154 variant derivation — `command-bar-ops.ts`
   *  re-applies the D110(1) mock mask itself; see `CommandBarInput`. */
  bar: CommandBarInput
  /** Viewer holds a seat (drives the Exit copy — Q13's honesty rule). */
  hasSeat: boolean
  /** Lobby mounts only (R396): a `draft_scheduled_at` instant exists, so
   *  the Exit copy may honestly promise the D94 auto-start. The no-schedule
   *  lobby gets the commissioner-starts-it sentence instead. */
  hasSchedule?: boolean
  /** The control handlers are absent on the LOBBY mount (DR.7(4)) — the
   *  model's lobby arm gates every control that would call them, so the
   *  live room is the only caller that ever needs them. */
  pausePending?: boolean
  onPauseResume?: (action: 'pause' | 'resume') => void
  /** Opens the §8.7 controls at the chosen group. DR.3 (D153): the bar's
   *  `Draft Options` control is the `draft-options-menu` — choosing a group
   *  opens the shipped `CommishDraftPanel` at that section. */
  onOpenDraftOptions?: (section: DraftOptionsSectionId) => void
  /** The reduced practice menu's delete-and-exit (launcher-only; the
   *  shipped `delete_mock_draft` verb — refuses everyone else in-RPC). */
  onDeletePractice?: () => void
  deletePending?: boolean
}

/**
 * The 54px draft-room command bar — spec §16.2 `draft-command-bar`, §16.4
 * zone 1 (v2.12; Chris's requirements (6)/(7)); tasks-DR DR.2, D149/D154.
 *
 * The room's OWN top chrome at every width — this is the surface that closes
 * the shipped M2 defect where the room's controls (commissioner panel
 * trigger, Pause practice, Exit room) lived in `PageHeader` actions that
 * rendered only in the shell's `AppHeader` at ≥lg, and — after DR.1 moved
 * the room out of the shell — nowhere at all.
 *
 * Exit Draft (Q13, ruled): a plain in-place navigation to the league home.
 * No `window.close()` (fails silently on non-script-opened tabs), no
 * confirmation. Leaving simply unmounts the room, which stops the
 * `draft_touch` heartbeat (`use-draft.ts` cleanup) — the §8.5.5 away path
 * (STALE after 45s → grace hold → Targets autopick; return restores manual
 * control). It must NOT touch `league_members.is_autodraft`. The honest
 * copy rides a `title` + a toast on the way out (`exitDraftCopy`).
 *
 * DR.7 completed §16.5.4's v2.12 note — the bar is now the room's ONE
 * banner surface: the reconnecting state renders here (the catalog's
 * `ReconnectingBanner`, moved out of the board zone), the MOCK identity is
 * the bar's badge alone (the stacked `MockBanner` left the room — the
 * recap, a shell page, keeps its own), and the pre-start LOBBY mounts this
 * same bar (status "Draft scheduled" + Exit; no controls — nothing runs
 * yet). The one-voice mapping is pinned in `one-voice.test.ts`.
 */
export function DraftCommandBar({
  leagueId,
  bar,
  hasSeat,
  hasSchedule = false,
  pausePending = false,
  onPauseResume,
  onOpenDraftOptions,
  onDeletePractice,
  deletePending = false,
}: DraftCommandBarProps) {
  const model = commandBarModel(bar)
  const showPauseResume = model.pauseResume !== null
  const showDraftOptions = model.draftOptions
  const showPracticeOptions = model.practiceOptions
  const showMockBadge = model.mockBadge
  const showReconnecting = model.reconnecting
  const exitTitle = exitDraftCopy({ isMock: bar.isMock, hasSeat, lobby: bar.lobby, hasSchedule })

  // Below `sm` the launcher's two controls compress ("Pause practice" →
  // "Pause", "Practice options" → "Options"): the densest variant (mock
  // launcher: badge + two controls + status + Exit) measured 410px of fixed
  // content against a 375px viewport in the DR.2 browser pass, clipping
  // Exit Draft off-screen — and the bar is the room's own chrome at EVERY
  // width. The Mock badge and the "Practice …" status keep the context the
  // short labels drop. "Exit Draft" never abbreviates (its name is ruled).
  const pauseVerb = model.pauseResume === 'resume' ? 'Resume' : 'Pause'
  const pauseLabel = pausePending ? (
    model.pauseResume === 'resume' ? 'Resuming…' : 'Pausing…'
  ) : (
    <>
      {pauseVerb}
      {bar.isMock && <span className="hidden sm:inline">&nbsp;practice</span>}
    </>
  )

  return (
    // D152 exception, stated: this bar is pinned chrome over scrolling content
    // (CLAUDE.md → Elevation, "bars pinned over scrolling content" is the
    // overlay clause), so it keeps a RESTING shadow deliberately —
    // `shadow-hard-accent-4`, the accent member of the sanctioned
    // `shadow-hard-*` family, because an ink shadow disappears into an ink
    // fill (tailwind.config.ts boxShadow note). Everything else in the room
    // stays interaction-prefixed per the ordinary rule.
    <header
      aria-label="Draft command bar"
      className="sticky top-0 z-40 flex h-draft-topbar w-full shrink-0 items-center gap-2 bg-ink px-3 text-white shadow-hard-accent-4"
    >
      {showMockBadge && (
        <Badge variant="yellow" className="shrink-0">
          Mock
        </Badge>
      )}
      {showMockBadge && (
        <span className="hidden shrink-0 text-[12px] font-bold sm:inline">Practice draft</span>
      )}

      {showPauseResume && (
        <Button
          variant="blue"
          size="sm"
          className="shrink-0"
          disabled={pausePending}
          onClick={() => onPauseResume?.(model.pauseResume === 'resume' ? 'resume' : 'pause')}
        >
          {pauseLabel}
        </Button>
      )}

      {showDraftOptions && (
        // The §8.7 door (DR.3): the menu of control groups, mapping 1:1 onto
        // the shipped commissioner-panel sections. Its trigger carries the
        // §16.3 accent treatment inside `draft-options-menu.tsx`.
        <DraftOptionsMenu onOpenSection={(section) => onOpenDraftOptions?.(section)} />
      )}

      {showPracticeOptions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="stroke"
              size="sm"
              className="shrink-0 border-white/40 text-white hover:bg-white hover:text-ink"
            >
              <span className="sm:hidden">Options</span>
              <span className="hidden sm:inline">Practice options</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              className="text-negative-strong focus:text-negative-strong"
              disabled={deletePending}
              onSelect={() => onDeletePractice?.()}
            >
              {deletePending ? 'Deleting…' : 'Delete practice & exit'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* One authoritative status line (§16.3 say-a-thing-once — the bar is
          the room's banner surface per §16.5.4's v2.12 note; DR.7 retired
          the duplicate tellings: the overlay's copy, the MockBanner, and
          the board-zone reconnecting banner all said their piece here or
          nowhere). */}
      <span role="status" className="min-w-0 truncate text-[12px] font-semibold text-white/75">
        {model.statusText}
      </span>

      {showReconnecting && (
        // DR.7(3): the §16.5.4 realtime-fallback state, IN the bar — one
        // strip, not a stack. Same trigger the M2 board-zone banner used
        // (`connection === 'reconnecting'` from useDraftRoom); the catalog
        // component renders here so the treatment AND the words stay
        // single-sourced in status-banners.tsx (its exported copy
        // constants). Below `sm` the sentence compresses to the compact
        // form and the chip ellipsizes rather than wrapping out of the
        // 54px band — the D176(5) responsive-label treatment, measured at
        // 375 in the densest (commissioner · paused) bar. It is a second
        // live region beside the status span, not a second telling —
        // connection state and draft state are different states.
        <ReconnectingBanner truncate className="min-w-0 shrink py-1">
          <span className="sm:hidden">{RECONNECTING_COPY_COMPACT}</span>
          <span className="hidden sm:inline">{RECONNECTING_COPY}</span>
        </ReconnectingBanner>
      )}

      {/* Exit Draft — UNCONDITIONAL, top-right (Q13: a commissioner must be
          able to leave too). Navigation and nothing else; the heartbeat
          cleanup is the away path. */}
      <Button
        variant="stroke"
        size="sm"
        className="ml-auto shrink-0 border-white/40 text-white hover:bg-white hover:text-ink"
        title={exitTitle}
        asChild
      >
        <Link
          href={`/app/leagues/${leagueId}`}
          onClick={() => {
            toast({ title: 'Left the draft room', description: exitTitle })
          }}
        >
          Exit Draft
        </Link>
      </Button>
    </header>
  )
}
