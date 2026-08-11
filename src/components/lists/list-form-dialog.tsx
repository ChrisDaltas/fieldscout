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
import { Input } from '@/components/ui/input'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useCreateList, useUpdateList } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { List, ListRosterSettings } from '@/types/database'
import type { POSITION_FILTERS } from '@/types/schemas/lists'

type PositionFilter = (typeof POSITION_FILTERS)[number]

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

type ListType = 'basic' | 'ranked' | 'team'

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

const DEFAULT_ROSTER: Omit<ListRosterSettings, 'total'> = {
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

function rosterTotal(r: Omit<ListRosterSettings, 'total'>): number {
  return r.qb + r.rb + r.wr + r.te + r.flex + r.dst + r.k + r.bench + r.ir
}

interface ListFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  list?: List
  /** Create mode only — adds this player to the list right after it's made. */
  seedPlayerId?: string | null
}

interface FormState {
  title: string
  positionFilter: PositionFilter | ''
  listType: ListType
  roster: Omit<ListRosterSettings, 'total'>
  isPrivate: boolean
}

function initialFormState(list: List | undefined): FormState {
  const listType: ListType = list?.is_team
    ? 'team'
    : list?.ranking_mode === 'unranked'
      ? 'basic'
      : 'ranked'
  return {
    title: list?.title ?? '',
    positionFilter: (list?.position_filter as PositionFilter | null) ?? '',
    listType,
    roster:
      (list?.roster_settings as Omit<ListRosterSettings, 'total'> | null) ??
      DEFAULT_ROSTER,
    isPrivate: list?.is_private ?? false,
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

  const [form, setForm] = useState<FormState>(() => initialFormState(list))

  // Reset whenever the modal opens — discards in-flight edits from a prior open.
  useEffect(() => {
    if (open) setForm(initialFormState(list))
  }, [open, list])

  const submitting = createList.isPending || updateList.isPending
  const canSubmit = form.title.trim().length > 0 && !submitting
  const isTeam = form.listType === 'team'
  const total = rosterTotal(form.roster)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    const payload = {
      title: form.title.trim(),
      position_filter: form.positionFilter || undefined,
      ranking_mode: (form.listType === 'basic' ? 'unranked' : 'ranked') as
        | 'unranked'
        | 'ranked',
      is_team: isTeam,
      roster_settings: isTeam ? { ...form.roster, total } : undefined,
      is_private: form.isPrivate,
    }

    try {
      if (mode === 'create') {
        const created = await createList.mutateAsync(payload)
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
        await updateList.mutateAsync(payload)
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
                      'flex w-full items-center justify-between gap-3 rounded-sm border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                      active
                        ? 'border-accent bg-accent-soft'
                        : 'border-ink bg-white hover:bg-n-4',
                    )}
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-bold text-ink">{opt.label}</span>
                      <span className="text-[11px] font-medium text-n-3">
                        {opt.description}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        active ? 'border-accent bg-accent' : 'border-ink bg-white',
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
                    <span className="mb-1 block text-[11px] font-bold text-ink">
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
                      className="fs-num h-9 px-2 text-sm"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs font-medium text-n-3">
                Total players:{' '}
                <span className="fs-num font-bold text-ink">{total}</span>
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
            <Button type="submit" variant="blue" shadow disabled={!canSubmit}>
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
      <label className="block text-[12px] font-bold text-ink">{label}</label>
      {children}
    </div>
  )
}
