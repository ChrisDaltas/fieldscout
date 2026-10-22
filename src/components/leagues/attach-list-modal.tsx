'use client'

import { useMemo, useState, type ReactNode } from 'react'

import { MCheck, MCheckRow, MWizardFooter } from '@/components/mobile/ui/m-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import {
  useAttachList,
  useAttachListAnyLeague,
  useLeagueLists,
  useListAttachments,
  useMyDraftLists,
  type MyDraftList,
} from '@/hooks/use-league-lists'
import { useLeagues } from '@/hooks/use-leagues'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { cn } from '@/lib/utils'

import {
  attachCandidates,
  attachSuggestion,
  attachedToastLine,
  leagueOptions,
} from './attach-list-ops'
import { useSettingsSkin } from './settings-form-controls'

/**
 * attach-list-modal (§16.2; §7.4; M2 task L.B4.2 — PROGRESS D122). The list
 * ↔ league tie-in's write surface, in BOTH directions over the same §15.5
 * POST:
 *
 *   - `AttachListToLeagueModal` — from a list (list detail / list card):
 *     "Attach to league" → pick from the leagues I belong to.
 *   - `AddDraftListModal` — from the league ("Add a draft list"): pick one
 *     of my lists (Big Board included). Its body is exported as
 *     `AttachListInline` so `LeagueCreateModal`'s success step composes the
 *     §7.4 create-flow offer INLINE (a Dialog inside a Dialog steals focus
 *     and closes both — the D119(6) nested-dialog lesson).
 *
 * Both directions carry the primary-board + share toggles (§7.4) and the
 * smart-suggestion one-tap (`attach-list-ops.ts` — the recorded heuristic).
 * Attach requires OWNING the list (the service's 403), so pickers only ever
 * offer the caller's own lists.
 */

// ---------------------------------------------------------------------------
// Shared toggles (§7.4: primary board + share)
// ---------------------------------------------------------------------------

function AttachToggles({
  primary,
  shared,
  onPrimary,
  onShared,
}: {
  primary: boolean
  shared: boolean
  onPrimary: (next: boolean) => void
  onShared: (next: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-2 text-[11px] font-semibold">
        <Checkbox
          checked={primary}
          onCheckedChange={(next) => onPrimary(next === true)}
          className="mt-0.5"
        />
        <span>
          Set as my primary board
          <span className="mt-0.5 block text-[10px] font-medium text-n-6">
            Feeds your draft Targets and autopick for this league (one per league).
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-[11px] font-semibold">
        <Checkbox
          checked={shared}
          onCheckedChange={(next) => onShared(next === true)}
          className="mt-0.5"
        />
        <span>
          Share with the league
          <span className="mt-0.5 block text-[10px] font-medium text-n-6">
            Every member can open it. Off, it stays visible only to you.
          </span>
        </span>
      </label>
    </div>
  )
}

function listMetaLine(list: MyDraftList): string {
  const parts = [
    `${list.player_count ?? 0} players`,
    list.position_filter ?? null,
    list.is_private === false ? 'Public' : 'Private',
  ].filter((part): part is string => part !== null)
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// League side: pick one of MY lists (also the create-flow inline offer)
// ---------------------------------------------------------------------------

interface AttachListInlineProps {
  leagueId: string
  leagueName: string
  /** The league's scoring template id — the suggestion heuristic's input. */
  scoringSystemId: string | null
  /** Rows already attached by the caller (ids of `lists`) — from
   *  `useLeagueLists` where mounted in a league surface; the create-flow
   *  offer passes an empty set (a fresh league has none). */
  attachedListIds: ReadonlySet<string>
  onAttached?: () => void
  /** Where the Attach button goes. Without it the button sits under the
   *  toggles; with it the body and the button are handed to the caller —
   *  the League tab's phone sheet pins the button in its footer (on the
   *  phone it arrives as the wizard footer). `attach` is null until there
   *  are lists to pick from (loading, error, none yet). */
  frame?: (parts: { body: ReactNode; attach: ReactNode | null }) => ReactNode
}

/** The league-side body: suggestion one-tap + list picker + toggles.
 *  Inline-safe (no Dialog) — the create-flow offer composes it directly.
 *  On the phone (`SettingsSkin` mobile) it is the ONE phone attach body:
 *  the create-league sheet's success step and the League tab's "Add a
 *  draft list" sheet both draw it — the blue suggestion strip, tick rows
 *  and tick toggles. */
export function AttachListInline({
  leagueId,
  leagueName,
  scoringSystemId,
  attachedListIds,
  onAttached,
  frame,
}: AttachListInlineProps) {
  const { user } = useAuth()
  const skin = useSettingsSkin()
  const myLists = useMyDraftLists(user?.id)
  const attach = useAttachList(leagueId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [primary, setPrimary] = useState(true)
  const [shared, setShared] = useState(false)

  const candidates = useMemo(
    () => attachCandidates(myLists.data ?? [], attachedListIds),
    [myLists.data, attachedListIds],
  )
  const suggestion = useMemo(
    () => attachSuggestion(myLists.data ?? [], scoringSystemId, attachedListIds),
    [myLists.data, scoringSystemId, attachedListIds],
  )

  const submit = (list: MyDraftList) => {
    if (attach.isPending) return
    attach.mutate(
      {
        list_id: list.id,
        is_primary_board: primary,
        shared_with_league: shared,
      },
      {
        onSuccess: () => {
          toast({ title: attachedToastLine(list.title, leagueName, primary, shared) })
          setSelectedId(null)
          onAttached?.()
        },
        onError: (error) => {
          toast({
            title: 'Attach failed',
            description:
              error instanceof LeagueActionError ? error.message : 'Please try again.',
            variant: 'destructive',
          })
        },
      },
    )
  }

  const m = skin === 'mobile'
  /** Hand the body (and the button, once there is one) to `frame`, or
   *  return the body as is. */
  const place = (body: ReactNode, attach: ReactNode | null = null) =>
    frame ? frame({ body, attach }) : body
  if (myLists.isPending) {
    if (m) {
      return place(
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading your lists">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className="block h-12 animate-pulse rounded-[14px] bg-m-b1" />
          ))}
        </div>,
      )
    }
    return place(
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[43px] w-full rounded-lg" />
        ))}
      </div>,
    )
  }
  if (myLists.isError) {
    if (m) {
      return place(
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p role="alert" className="text-[13px] font-medium text-m-t3">
            Your lists didn&rsquo;t load.
          </p>
          <button
            type="button"
            onClick={() => void myLists.refetch()}
            className="flex h-9 items-center rounded-pill bg-m-b2 px-4 text-[13px] font-semibold text-m-t1 active:bg-m-b2h"
          >
            Try again
          </button>
        </div>,
      )
    }
    return place(
      <div className="flex flex-col items-start gap-2">
        <p className="text-[11px] font-medium text-n-3" role="alert">
          Your lists didn&rsquo;t load.
        </p>
        <Button variant="stroke" size="sm" onClick={() => void myLists.refetch()}>
          Retry
        </Button>
      </div>,
    )
  }
  if (candidates.length === 0) {
    return place(
      <p className={m ? 'py-6 text-center text-[13px] font-medium leading-[1.4] text-m-t3' : 'py-3 text-center text-[11px] font-medium text-n-6'}>
        You don&rsquo;t have any lists yet. Build one on the Lists page and it
        will show up here.
      </p>,
    )
  }

  const selected = candidates.find((c) => c.id === selectedId) ?? null
  const attachLabel = attach.isPending ? 'Attaching…' : 'Attach list'
  const attachOff = !selected || attach.isPending
  const attachSelected = () => selected && submit(selected)

  if (m) {
    // Inline it is the pill under the toggles; handed to a sheet's footer it
    // is the wizard footer's full-width button (the same off state).
    const attachButton = frame ? (
      <MWizardFooter label={attachLabel} onClick={attachSelected} disabled={attachOff} />
    ) : (
      <button
        type="button"
        disabled={attachOff}
        onClick={attachSelected}
        className="flex h-10 w-fit items-center rounded-pill bg-accent px-[18px] text-[14px] font-semibold text-white active:bg-accent-strong disabled:bg-m-b3s disabled:text-m-t3"
      >
        {attachLabel}
      </button>
    )
    return place(
      <div className="flex flex-col gap-3">
        {suggestion && (
          <div className="flex items-center gap-3 rounded-[14px] bg-m-b1 px-3 py-2.5">
            <span className="min-w-0 flex-1 text-[12px] font-semibold text-m-t1">
              {suggestion.is_big_board && !suggestion.scoring_system_id
                ? 'Your Big Board fits any draft.'
                : `“${suggestion.title}” matches this league’s scoring.`}
            </span>
            <button
              type="button"
              disabled={attach.isPending}
              onClick={() => submit(suggestion)}
              className="flex h-8 flex-none items-center rounded-pill bg-accent px-3.5 text-[13px] font-semibold text-white active:bg-accent-strong disabled:opacity-50"
            >
              Attach {suggestion.is_big_board ? 'Big Board' : 'it'}
            </button>
          </div>
        )}
        <div role="radiogroup" aria-label="Your lists" className="flex flex-col">
          {candidates.map((candidate) => {
            const on = selectedId === candidate.id
            return (
              <button
                key={candidate.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={candidate.attached}
                onClick={() => setSelectedId(candidate.id)}
                className="flex min-h-[52px] items-center gap-3 border-b border-m-b2 py-2 text-left disabled:opacity-60"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-[14px] font-semibold text-m-t1">{candidate.title}</span>
                  <span className="truncate text-[12px] font-medium text-m-t3">
                    {[listMetaLine(candidate), candidate.is_big_board ? 'Big Board' : null, candidate.attached ? 'Attached' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <MCheck on={on} />
              </button>
            )
          })}
        </div>
        <MCheckRow
          on={primary}
          onChange={setPrimary}
          label="Set as my primary board"
          note="Feeds your draft Targets and autopick for this league (one per league)."
        />
        <MCheckRow on={shared} onChange={setShared} label="Share with the league" note="Every member can open it. Off, it stays visible only to you." />
        {!frame && attachButton}
      </div>,
      attachButton,
    )
  }

  const desktopAttach = (
    <Button variant="blue" size="md" className="w-fit" disabled={attachOff} onClick={attachSelected}>
      {attachLabel}
    </Button>
  )
  return place(
    <div className="flex flex-col gap-3">
      {suggestion && (
        // §7.4 smart suggestion: the one-tap attach (heuristic recorded in
        // attach-list-ops.ts). One button — the toggles above still apply.
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent-soft py-1.5 pl-3 pr-1.5">
          <span className="min-w-0 text-[11px] font-semibold text-accent-deep">
            <Icon name="star" size={12} className="mr-1 inline align-[-1px] text-accent" />
            {suggestion.is_big_board && !suggestion.scoring_system_id
              ? 'Your Big Board fits any draft.'
              : `“${suggestion.title}” matches this league’s scoring.`}
          </span>
          <Button
            variant="stroke"
            size="sm"
            disabled={attach.isPending}
            onClick={() => submit(suggestion)}
          >
            Attach {suggestion.is_big_board ? 'Big Board' : 'it'}
          </Button>
        </div>
      )}

      <div className="flex max-h-56 flex-col gap-[3px] overflow-y-auto">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            disabled={candidate.attached}
            aria-pressed={selectedId === candidate.id}
            onClick={() => setSelectedId(candidate.id)}
            className={cn(
              'flex min-h-[43px] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
              candidate.attached
                ? 'cursor-default opacity-60'
                : selectedId === candidate.id
                  ? 'bg-accent-soft text-accent-deep'
                  : 'hover:bg-surface-sunken',
            )}
          >
            <Icon name="list" size={14} className="shrink-0 text-n-3" />
            <span className="mr-auto min-w-0">
              <span className="block truncate text-[12px] font-semibold">{candidate.title}</span>
              <span className="block text-[10px] font-medium text-n-6">
                {listMetaLine(candidate)}
              </span>
            </span>
            {candidate.is_big_board && <Badge variant="stroke">Big Board</Badge>}
            {candidate.attached && <Badge variant="stroke">Attached</Badge>}
          </button>
        ))}
      </div>

      <AttachToggles
        primary={primary}
        shared={shared}
        onPrimary={setPrimary}
        onShared={setShared}
      />

      {!frame && desktopAttach}
    </div>,
    desktopAttach,
  )
}

interface AddDraftListModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  leagueId: string
  leagueName: string
  scoringSystemId: string | null
  attachedListIds: ReadonlySet<string>
  /** Where focus returns on close, for a CONTROLLED mount with no trigger
   *  (the draft room's room-level mount — L.F1.1, D622). Radix's default is
   *  the trigger, and with none it is BODY. */
  onCloseAutoFocus?: (event: Event) => void
}

/** The league-side modal ("Add a draft list" — §7.4's reverse entry). */
export function AddDraftListModal({
  open,
  onOpenChange,
  leagueId,
  leagueName,
  scoringSystemId,
  attachedListIds,
  onCloseAutoFocus,
}: AddDraftListModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] max-w-md flex-col gap-3.5 overflow-y-auto"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Add a draft list</DialogTitle>
          <DialogDescription>
            Attach one of your ranking lists to {leagueName} — it&rsquo;s one tap
            away in the draft room and all season.
          </DialogDescription>
        </DialogHeader>
        <AttachListInline
          leagueId={leagueId}
          leagueName={leagueName}
          scoringSystemId={scoringSystemId}
          attachedListIds={attachedListIds}
          onAttached={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// List side: pick a league ("Attach to league" from list detail/card)
// ---------------------------------------------------------------------------

interface AttachListToLeagueModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  list: { id: string; title: string }
}

export function AttachListToLeagueModal({
  open,
  onOpenChange,
  list,
}: AttachListToLeagueModalProps) {
  const { user } = useAuth()
  const leagues = useLeagues({ enabled: open })
  const attachments = useListAttachments(list.id, user?.id, open)
  const attach = useAttachListAnyLeague()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [primary, setPrimary] = useState(true)
  const [shared, setShared] = useState(false)

  const options = useMemo(
    () =>
      leagueOptions(
        leagues.data ?? [],
        new Set((attachments.data ?? []).map((row) => row.league_id)),
      ),
    [leagues.data, attachments.data],
  )
  const selected = options.find((o) => o.id === selectedId) ?? null

  const submit = () => {
    if (!selected || attach.isPending) return
    attach.mutate(
      {
        leagueId: selected.id,
        list_id: list.id,
        is_primary_board: primary,
        shared_with_league: shared,
      },
      {
        onSuccess: () => {
          toast({ title: attachedToastLine(list.title, selected.name, primary, shared) })
          setSelectedId(null)
          onOpenChange(false)
        },
        onError: (error) => {
          toast({
            title: 'Attach failed',
            description:
              error instanceof LeagueActionError ? error.message : 'Please try again.',
            variant: 'destructive',
          })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-3.5 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attach to league</DialogTitle>
          <DialogDescription>
            Make &ldquo;{list.title}&rdquo; a draft reference in one of your
            leagues.
          </DialogDescription>
        </DialogHeader>

        {leagues.isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[43px] w-full rounded-lg" />
            ))}
          </div>
        ) : leagues.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-[11px] font-medium text-n-3" role="alert">
              Your leagues didn&rsquo;t load.
            </p>
            <Button variant="stroke" size="sm" onClick={() => void leagues.refetch()}>
              Retry
            </Button>
          </div>
        ) : options.length === 0 ? (
          <p className="py-3 text-center text-[11px] font-medium text-n-6">
            You&rsquo;re not in any leagues yet. Create or join one first.
          </p>
        ) : (
          <>
            <div className="flex max-h-56 flex-col gap-[3px] overflow-y-auto">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={option.attached}
                  aria-pressed={selectedId === option.id}
                  onClick={() => setSelectedId(option.id)}
                  className={cn(
                    'flex min-h-[43px] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                    option.attached
                      ? 'cursor-default opacity-60'
                      : selectedId === option.id
                        ? 'bg-accent-soft text-accent-deep'
                        : 'hover:bg-surface-sunken',
                  )}
                >
                  <Icon name="cup" size={14} className="shrink-0 text-n-3" />
                  <span className="mr-auto min-w-0 truncate text-[12px] font-semibold">
                    {option.name}
                  </span>
                  {option.status === 'drafting' && <Badge variant="lime">Draft live</Badge>}
                  {option.status === 'scheduled' && <Badge variant="stroke">Scheduled</Badge>}
                  {option.attached && <Badge variant="stroke">Attached</Badge>}
                </button>
              ))}
            </div>

            <AttachToggles
              primary={primary}
              shared={shared}
              onPrimary={setPrimary}
              onShared={setShared}
            />

            <Button
              variant="blue"
              size="md"
              className="w-fit"
              disabled={!selected || attach.isPending}
              onClick={submit}
            >
              {attach.isPending ? 'Attaching…' : 'Attach to league'}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// League-side entry CTA ("Add a draft list" — league home / lobby / panel)
// ---------------------------------------------------------------------------

/**
 * The §7.4 reverse entry point, self-contained: button + modal. Reads the
 * league's attached rows itself so every mount site stays one line.
 */
export function AddDraftListCta({
  leagueId,
  leagueName,
  scoringSystemId,
  variant = 'stroke',
}: {
  leagueId: string
  leagueName: string
  scoringSystemId: string | null
  variant?: 'stroke' | 'ghost'
}) {
  const [open, setOpen] = useState(false)
  const { user } = useAuth()
  // Fetch only once the modal opens; the picker's Attached flags are MY
  // attached list ids in this league (the §15.5 GET is mine + shared —
  // filter to mine, the natural key is per-owner).
  const rows = useLeagueLists(leagueId, open)
  const attachedListIds = useMemo(
    () =>
      new Set(
        (rows.data ?? [])
          .filter((row) => row.owner_id === user?.id)
          .map((row) => row.list_id),
      ),
    [rows.data, user?.id],
  )

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        <Icon name="list" size={13} />
        Add a draft list
      </Button>
      <AddDraftListModal
        open={open}
        onOpenChange={setOpen}
        leagueId={leagueId}
        leagueName={leagueName}
        scoringSystemId={scoringSystemId}
        attachedListIds={attachedListIds}
      />
    </>
  )
}
