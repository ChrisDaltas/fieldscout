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
import { toast } from '@/hooks/use-toast'

import { commandBarModel, exitDraftCopy, type CommandBarInput } from './command-bar-ops'

interface DraftCommandBarProps {
  leagueId: string
  /** The raw pieces of the D154 variant derivation — `command-bar-ops.ts`
   *  re-applies the D110(1) mock mask itself; see `CommandBarInput`. */
  bar: CommandBarInput
  /** Viewer holds a seat (drives the Exit copy — Q13's honesty rule). */
  hasSeat: boolean
  pausePending: boolean
  onPauseResume: (action: 'pause' | 'resume') => void
  /** Opens the §8.7 controls. DR.2 opens the shipped `CommishDraftPanel`
   *  directly (D153: the panel keeps its body, loses its trigger); DR.3
   *  replaces this handler's target with the `draft-options-menu`. */
  onOpenDraftOptions: () => void
  /** The reduced practice menu's delete-and-exit (launcher-only; the
   *  shipped `delete_mock_draft` verb — refuses everyone else in-RPC). */
  onDeletePractice: () => void
  deletePending: boolean
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
 */
export function DraftCommandBar({
  leagueId,
  bar,
  hasSeat,
  pausePending,
  onPauseResume,
  onOpenDraftOptions,
  onDeletePractice,
  deletePending,
}: DraftCommandBarProps) {
  const model = commandBarModel(bar)
  const showPauseResume = model.pauseResume !== null
  const showDraftOptions = model.draftOptions
  const showPracticeOptions = model.practiceOptions
  const showMockBadge = model.mockBadge
  const exitTitle = exitDraftCopy({ isMock: bar.isMock, hasSeat })

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
          onClick={() => onPauseResume(model.pauseResume === 'resume' ? 'resume' : 'pause')}
        >
          {pauseLabel}
        </Button>
      )}

      {showDraftOptions && (
        // §16.3 (v2.12): commissioner power behind ONE labeled control in
        // the room's own chrome — the accent fill is the commissioner
        // signature.
        <Button variant="blue" size="sm" className="shrink-0" onClick={onOpenDraftOptions}>
          Draft Options
        </Button>
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
              onSelect={() => onDeletePractice()}
            >
              {deletePending ? 'Deleting…' : 'Delete practice & exit'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* One authoritative status line (§16.3 say-a-thing-once — the bar is
          the room's banner surface per §16.5.4's v2.12 note; DR.7 retires
          the duplicate tellings). */}
      <span role="status" className="min-w-0 truncate text-[12px] font-semibold text-white/75">
        {model.statusText}
      </span>

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
