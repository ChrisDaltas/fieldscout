'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  listFormPayload,
  rosterTotal,
  type ListFormState,
  type ListType,
  type PositionFilter,
  type RosterDraft,
} from '@/components/lists/list-form-payload'
import { COVER_COLOR_TINTS } from '@/components/lists/list-thumbnail'
import { Input } from '@/components/ui/input'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useListCoverColorSupport } from '@/hooks/use-list-cover-color-support'
import { useCreateList, useUpdateList } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import {
  COVER_COLORS,
  COVER_COLOR_LABEL,
  coverColorOf,
  hasCoverColorColumn,
  type CoverColor,
} from '@/lib/lists/cover-color'
import { isNumbered } from '@/lib/lists/ranking-mode'
import { cn } from '@/lib/utils'
import type { List, ListRosterSettings } from '@/types/database'

interface PositionOption {
  value: PositionFilter | ''
  label: string
}

const POSITION_OPTIONS: PositionOption[] = [
  { value: '', label: 'All players' },
  { value: 'QB', label: 'QB' },
  { value: 'RB', label: 'RB' },
  { value: 'WR', label: 'WR' },
  { value: 'FLEX', label: 'Flex' },
  { value: 'TE', label: 'TE' },
  { value: 'DEF', label: 'DEF/ST' },
  { value: 'K', label: 'K' },
]

interface ListTypeOption {
  value: ListType
  label: string
  description: string
}

const LIST_TYPE_OPTIONS: ListTypeOption[] = [
  {
    value: 'basic',
    label: 'Basic',
    description: 'Just a collection, no order.',
  },
  {
    value: 'ranked',
    label: 'Ranked',
    description: 'Numbered 1–N. Flip on the tiers view any time.',
  },
  {
    value: 'team',
    label: 'Team',
    description: 'A roster with starters, bench, and IR slots.',
  },
]

/** Starting-lineup fields shown when the Team type is selected. */
const ROSTER_FIELDS: { key: keyof Omit<ListRosterSettings, 'total'>; label: string }[] = [
  { key: 'qb', label: 'QB' },
  { key: 'rb', label: 'RB' },
  { key: 'wr', label: 'WR' },
  { key: 'flex', label: 'Flex' },
  { key: 'te', label: 'TE' },
  { key: 'dst', label: 'DST' },
  { key: 'k', label: 'K' },
  { key: 'bench', label: 'Bench' },
  { key: 'ir', label: 'IR' },
]

const DEFAULT_ROSTER: RosterDraft = {
  qb: 1,
  rb: 2,
  wr: 2,
  te: 1,
  flex: 1,
  dst: 1,
  k: 1,
  bench: 6,
  ir: 2,
}

/**
 * The selected swatch's outer ring, in its own colour (lr-lists §2.2: a 2px
 * page-colour gap, then the colour). The fills are `COVER_COLOR_TINTS`, the
 * same map the list cover itself uses.
 */
export const COVER_RING: Record<CoverColor, string> = {
  blue: 'ring-accent',
  ink: 'ring-ink',
  red: 'ring-pos-qb',
  purple: 'ring-pos-wr',
  indigo: 'ring-pos-rb',
  green: 'ring-confirm',
}

interface ListFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  list?: List
  /** Create mode only — adds this player to the list right after it's made. */
  seedPlayerId?: string | null
}

function initialFormState(list: List | undefined): ListFormState {
  // Basic = no numbers: a plain list, or tiers without numbers (191).
  const listType: ListType = list?.is_team
    ? 'team'
    : !isNumbered(list?.ranking_mode)
      ? 'basic'
      : 'ranked'
  return {
    title: list?.title ?? '',
    positionFilter: (list?.position_filter as PositionFilter | null) ?? '',
    listType,
    roster:
      (list?.roster_settings as RosterDraft | null) ??
      DEFAULT_ROSTER,
    isPrivate: list?.is_private ?? false,
    coverColor: coverColorOf(list),
  }
}

export function ListFormDialog({
  open,
  onOpenChange,
  mode,
  list,
  seedPlayerId = null,
}: ListFormDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const createList = useCreateList()
  const updateList = useUpdateList(list?.id ?? '')

  const [form, setForm] = useState<ListFormState>(() => initialFormState(list))

  // Reset whenever the modal opens — discards in-flight edits from a prior open.
  useEffect(() => {
    if (open) setForm(initialFormState(list))
  }, [open, list])

  // Cover colours only once `lists.cover_color` exists (main deploys before
  // migration 188 is pushed): an existing list proves it by carrying the key;
  // a new one asks the database.
  const colourProbe = useListCoverColorSupport(open && mode === 'create')
  const coloursReady = mode === 'edit' ? hasCoverColorColumn(list) : colourProbe.data === true

  const submitting = createList.isPending || updateList.isPending
  const canSubmit = form.title.trim().length > 0 && !submitting
  const isTeam = form.listType === 'team'
  const total = rosterTotal(form.roster)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    // The body (cover colour, "All players" → no position) is built and
    // tested in list-form-payload — per mode, since create and edit differ.
    try {
      if (mode === 'create') {
        const created = await createList.mutateAsync(
          listFormPayload(form, { mode: 'create', coloursReady }),
        )
        if (seedPlayerId) {
          await fetch(`/api/lists/${created.id}/players`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ player_id: seedPlayerId }),
          }).catch(() => {})
        }
        toast({ title: 'List created', description: created.title })
        onOpenChange(false)
        router.push(`/app/lists/${created.id}`)
      } else if (list) {
        await updateList.mutateAsync(listFormPayload(form, { mode: 'edit', list, coloursReady }))
        toast({ title: 'List updated', description: form.title.trim() })
        onOpenChange(false)
      }
    } catch (err) {
      toast({
        title: mode === 'create' ? 'Could not create list' : 'Could not save changes',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Create a list' : 'Edit list'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="List name">
            <Input
              autoFocus
              value={form.title}
              onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
              maxLength={100}
              placeholder="e.g. Top 10 sleeper picks"
              required
            />
          </Field>

          {!isTeam && (
            <Field label="Position group">
              {/* Exactly one option is always chosen ('' = All players), so this
                  is a segment rather than a chip row (LV.11). A **grid**, not a
                  wrapping flex row: eight options overflow 375px, and a wrapped
                  flex row strands 'K' alone on a second line with a ragged gap
                  above it. 4×2 is the same shape the AI modal's position picker
                  uses for the same choice. */}
              <Segment aria-label="Position group" className="grid w-full grid-cols-4">
                {POSITION_OPTIONS.map((opt) => (
                  <SegmentItem
                    key={opt.value || 'all'}
                    active={form.positionFilter === opt.value}
                    onClick={() =>
                      setForm((s) => ({ ...s, positionFilter: opt.value }))
                    }
                  >
                    {opt.label}
                  </SegmentItem>
                ))}
              </Segment>
            </Field>
          )}

          {coloursReady && (
            <Field label="Cover colour">
              <CoverColorPicker
                value={form.coverColor}
                onChange={(coverColor) => setForm((s) => ({ ...s, coverColor }))}
                isTeam={isTeam}
              />
            </Field>
          )}

          <Field label="Type">
            <div className="space-y-1.5">
              {LIST_TYPE_OPTIONS.map((opt) => {
                const active = form.listType === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={mode === 'edit'}
                    onClick={() =>
                      setForm((s) => ({
                        ...s,
                        listType: opt.value,
                        // Team lists hold full rosters — no position lock.
                        positionFilter:
                          opt.value === 'team' ? '' : s.positionFilter,
                      }))
                    }
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-[background-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-40',
                      // Selected is a fill plus v7's 1px inset accent ring
                      // (the selected-chip form) — never a lift.
                      active
                        ? 'bg-accent-soft shadow-ring-accent'
                        : 'bg-surface-sunken hover:bg-surface-hover',
                    )}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[13px] font-semibold text-ink">{opt.label}</span>
                      <span className="text-[11px] font-medium text-n-3">
                        {opt.description}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                        active ? 'bg-accent' : 'bg-white shadow-ring-control',
                      )}
                    >
                      {active && (
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </Field>

          {isTeam && (
            <Field label="Roster">
              <div className="grid grid-cols-3 gap-2">
                {ROSTER_FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1 block text-[10px] font-semibold text-n-3">
                      {f.label}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={form.roster[f.key]}
                      onChange={(e) => {
                        const v = Math.max(
                          0,
                          Math.min(20, Number(e.target.value) || 0),
                        )
                        setForm((s) => ({
                          ...s,
                          roster: { ...s.roster, [f.key]: v },
                        }))
                      }}
                      className="fs-num px-2"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] font-medium text-n-6">
                Total players:{' '}
                <span className="fs-num font-semibold text-ink">{total}</span>
              </p>
            </Field>
          )}

          <Field label="Visibility">
            <Segment aria-label="Visibility">
              <SegmentItem
                active={!form.isPrivate}
                onClick={() => setForm((s) => ({ ...s, isPrivate: false }))}
              >
                Public
              </SegmentItem>
              <SegmentItem
                active={form.isPrivate}
                onClick={() => setForm((s) => ({ ...s, isPrivate: true }))}
              >
                Private
              </SegmentItem>
            </Segment>
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="stroke"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="blue" disabled={!canSubmit}>
              {submitting
                ? mode === 'create'
                  ? 'Creating…'
                  : 'Saving…'
                : mode === 'create'
                  ? 'Create list'
                  : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold text-ink">{label}</label>
      {children}
    </div>
  )
}

/**
 * The six cover colours (Chris, 2026-10-15 — the mobile design's swatches,
 * lr-lists §2.2, in this dialog's desktop scale): 20px circles, gap 8, the
 * chosen one ringed in its own colour past a 2px white gap. No colour chosen
 * = the cover follows the position group; clicking the chosen colour again
 * goes back to that. A team list has no position group (its field is
 * hidden), so for one the line says "the default colour" — the ink its tile
 * falls back to. Selection is the ring, never a lift (CLAUDE.md →
 * elevation).
 */
export function CoverColorPicker({
  value,
  onChange,
  isTeam = false,
}: {
  value: CoverColor | null
  onChange: (next: CoverColor | null) => void
  isTeam?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div role="group" aria-label="Cover colour" className="flex gap-2 py-0.5 pl-0.5">
        {COVER_COLORS.map((key) => {
          const on = value === key
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              aria-label={COVER_COLOR_LABEL[key]}
              title={COVER_COLOR_LABEL[key]}
              onClick={() => onChange(on ? null : key)}
              className={cn(
                'size-5 shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent',
                COVER_COLOR_TINTS[key].bg,
                on && cn('ring-[1.5px] ring-offset-2 ring-offset-white', COVER_RING[key]),
              )}
            />
          )
        })}
      </div>
      <p className="text-[11px] font-medium text-n-6">
        {isTeam
          ? value
            ? 'Click it again to go back to the default colour.'
            : 'Uses the default colour until you pick one.'
          : value
            ? 'Click it again to follow the position group.'
            : 'Follows the position group until you pick one.'}
      </p>
    </div>
  )
}
