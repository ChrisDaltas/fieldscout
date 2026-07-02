'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
  { value: '', label: 'All Players' },
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-bg-elevated-2 bg-bg-elevated sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New list' : 'Edit list'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Name">
            <Input
              autoFocus
              value={form.title}
              onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
              maxLength={100}
              placeholder="e.g. 2026 PPR Top 100"
              required
            />
          </Field>

          {!isTeam && (
            <Field label="Position group">
              <div className="grid grid-cols-4 gap-1.5">
                {POSITION_OPTIONS.map((opt) => {
                  const active = form.positionFilter === opt.value
                  return (
                    <button
                      key={opt.value || 'all'}
                      type="button"
                      onClick={() =>
                        setForm((s) => ({ ...s, positionFilter: opt.value }))
                      }
                      className={cn(
                        'rounded-full px-2 py-1.5 text-xs font-semibold transition-colors',
                        active
                          ? 'bg-foreground text-background'
                          : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
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
                      'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      active
                        ? 'border-foreground bg-bg-elevated-2 text-foreground'
                        : 'border-bg-elevated-2 bg-bg-elevated-3 text-text-secondary hover:border-bg-elevated-3 hover:text-foreground',
                    )}
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold">{opt.label}</span>
                      <span className="text-[11px] text-text-tertiary">
                        {opt.description}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                        active
                          ? 'border-foreground bg-foreground'
                          : 'border-bg-elevated-3',
                      )}
                    >
                      {active && (
                        <span className="h-1.5 w-1.5 rounded-full bg-background" />
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
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
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
                      className="h-8 px-2 text-sm tabular-nums"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-secondary">
                Total players:{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {total}
                </span>
              </p>
            </Field>
          )}

          <Field label="Visibility">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setForm((s) => ({ ...s, isPrivate: false }))}
                className={cn(
                  'rounded-full px-3 py-2 text-sm font-semibold transition-colors',
                  !form.isPrivate
                    ? 'bg-foreground text-background'
                    : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
                )}
              >
                Public
              </button>
              <button
                type="button"
                onClick={() => setForm((s) => ({ ...s, isPrivate: true }))}
                className={cn(
                  'rounded-full px-3 py-2 text-sm font-semibold transition-colors',
                  form.isPrivate
                    ? 'bg-foreground text-background'
                    : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
                )}
              >
                Private
              </button>
            </div>
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="invisible"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {mode === 'create' ? 'Create' : 'Save'}
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
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </label>
      {children}
    </div>
  )
}
