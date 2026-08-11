'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { ScoutAiMark } from '@/components/ui/ai-insight'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useAiGenerationQuota } from '@/hooks/use-ai-generation-quota'
import { listsKeys } from '@/hooks/use-lists'
import { ANALYTICAL_STYLES } from '@/lib/claude/styles'
import { featureFlags } from '@/lib/feature-flags'
import { createBrowserClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useAiBuildStore } from '@/stores/ai-build-store'
import type { AnalyticalStyleKey, GenerateListRequest } from '@/types/schemas/ai'

const POSITIONS = ['Overall', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'] as const
const SCORINGS = ['PPR', 'Half-PPR', 'Standard'] as const
const COUNTS = [5, 10, 15, 25, 50] as const

type Position = (typeof POSITIONS)[number]
type Scoring = (typeof SCORINGS)[number]
type Count = (typeof COUNTS)[number]

type Step = 'form' | 'creating'

interface GenerateAiModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface PersonaOption {
  username: string
  display_name: string
}

function usePersonaStyles(enabled: boolean) {
  return useQuery({
    queryKey: ['ai-personas', 'styles'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PersonaOption[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('ai_personas')
        .select('username, display_name')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('display_name')
      if (error) throw error
      return (data ?? []) as PersonaOption[]
    },
  })
}

/**
 * "Create with AI" — collects the brief, creates the (empty) list, queues the
 * AI build job, and immediately navigates to wherever the open list lives so
 * the user watches the AI add players and put them in order (useAiListBuild).
 * Scout AI surface: accent-blue moments, never lime.
 *
 * **Already largely in the new design language before LV.5**: LV.9 and LV.11
 * converted its single-select rows onto the shared segment control and its
 * multi-select rows stayed on `FilterChip`. LV.5 finished the job — the shared
 * `ScoutAiMark` instead of a fourth hand-copy of it, the v2 state cards for the
 * quota and error notices, and the navigation fix above, which is the part that
 * actually mattered.
 */
export function GenerateAiModal({ open, onOpenChange }: GenerateAiModalProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const personas = usePersonaStyles(open)
  const startBuild = useAiBuildStore((s) => s.start)
  // Refetched on every open so a generation started in another tab is
  // reflected before the user spends a click.
  const quota = useAiGenerationQuota(open)

  const [step, setStep] = useState<Step>('form')
  const [position, setPosition] = useState<Position>('WR')
  const [scoring, setScoring] = useState<Scoring>('PPR')
  /** Optional: style key → importance (1–3). Empty = no style bias. */
  const [styleWeights, setStyleWeights] = useState<Record<string, number>>({})
  /** Optional: selected persona username. Null = no AI expert. */
  const [persona, setPersona] = useState<string | null>(null)
  const [count, setCount] = useState<Count>(10)
  const [error, setError] = useState<string | null>(null)

  // Staleness guard: bumped on every open AND close so in-flight async work
  // from a previous dialog session can never mutate fresh state.
  const sessionRef = useRef(0)

  // Reset transient state on every open; invalidate stale handlers on close.
  useEffect(() => {
    sessionRef.current += 1
    if (open) {
      setStep('form')
      setError(null)
    }
  }, [open])

  // Quota unreadable → let the user try; the route is the real gate.
  const outOfGenerations = quota.data ? quota.data.remaining <= 0 : false
  const generationsOff = quota.data ? quota.data.limit <= 0 : false

  // Don't allow dismissal mid-create (Esc, overlay, X all route through here
  // in controlled mode) — the create finishing after dismissal would navigate
  // out of nowhere.
  const handleOpenChange = (next: boolean) => {
    if (!next && step === 'creating') return
    onOpenChange(next)
  }

  const handleCreate = async () => {
    // Client-side pre-check so we don't create an empty list the AI can't
    // fill. Advisory only — the route's atomic claim is the real limit.
    if (outOfGenerations) return
    const session = sessionRef.current
    setStep('creating')
    setError(null)
    try {
      // Mirrors the server's style label; the list is retitled after
      // generation anyway if resolution drops players.
      const personaName = persona
        ? (personas.data?.find((p) => p.username === persona)?.display_name ?? persona)
        : null
      const hasWeights = Object.keys(styleWeights).length > 0
      const styleLabel =
        personaName && hasWeights
          ? `${personaName} Blend`
          : (personaName ?? (hasWeights ? 'Custom Blend' : 'Consensus'))
      const title = `${styleLabel} ${position} Top ${count}`.slice(0, 100)

      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          position_filter: position === 'Overall' ? undefined : position,
          ranking_mode: 'ranked',
        }),
      })
      if (sessionRef.current !== session) return
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null
        throw new Error(
          typeof body?.error === 'string' ? body.error : 'Could not create the list.',
        )
      }
      const created = (await res.json()) as { id: string }

      const weightEntries = Object.entries(styleWeights).map(([key, weight]) => ({
        key: key as AnalyticalStyleKey,
        weight: weight as 1 | 2 | 3,
      }))
      const request: GenerateListRequest = {
        position,
        scoring,
        player_count: count,
        ...(persona ? { persona } : {}),
        ...(weightEntries.length > 0 ? { style_weights: weightEntries } : {}),
      }
      startBuild(created.id, request)

      queryClient.invalidateQueries({ queryKey: listsKeys.all })
      onOpenChange(false)
      // **Where the build show runs differs by flag (LV.5).** Lists v2 has no
      // standalone detail screen — a list opens in the right-hand panel of the
      // Lists page (§7 gap 1), and `/app/lists/[listId]` is still a placeholder
      // behind the flag, so pushing it would strand the build on a "coming
      // soon" card. The page reads the queued job to know which list to open,
      // so no query parameter is needed. The ternary collapses at LV.7.
      router.push(featureFlags.listsV2 ? '/app/lists' : `/app/lists/${created.id}`)
    } catch (err) {
      if (sessionRef.current !== session) return
      setError(err instanceof Error ? err.message : 'Could not create the list.')
      setStep('form')
    }
  }

  /** Cycle a style's importance: unset → 1 → 2 → 3 → unset. */
  const cycleStyleWeight = (key: string) => {
    setStyleWeights((prev) => {
      const next = ((prev[key] ?? 0) + 1) % 4
      const copy = { ...prev }
      if (next === 0) delete copy[key]
      else copy[key] = next
      return copy
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScoutAiMark />
            Generate with AI
          </DialogTitle>
        </DialogHeader>

        {/* Both notices follow the v2 state cards (LV.5): square ink frame, a
            13px bold headline over an 11px detail, the red frame reserved for
            an actual failure. "Out of generations" is a normal state, not an
            error, so it keeps the neutral card — the same split the build
            banner makes for a `blocked` job. */}
        {outOfGenerations && quota.data && (
          <div className="border border-ink bg-white p-card-pad">
            <p className="text-[13px] font-bold text-ink">
              {generationsOff
                ? 'AI generation is paused right now'
                : `That's your ${quota.data.limit} AI ${quota.data.limit === 1 ? 'list' : 'lists'} for today`}
            </p>
            <p className="mt-1 text-[11px] font-medium text-n-3">
              {generationsOff
                ? 'It will be back shortly. Building a list by hand works exactly as always.'
                : `A daily cap keeps FieldScout's AI costs sustainable while the app is free. You get ${quota.data.limit} more when the day rolls over at midnight UTC — and you can build a list by hand any time.`}
            </p>
          </div>
        )}

        {error && (
          <div className="border border-negative-strong bg-negative-soft p-card-pad">
            <div className="flex items-center gap-2">
              <Icon name="info-circle" size={14} className="text-negative-strong" />
              <p className="text-[13px] font-bold text-ink">Could not create the list</p>
            </div>
            <p className="mt-1 text-[11px] font-medium text-n-3">{error}</p>
          </div>
        )}

        <div className="space-y-5">
          <Field label="Position">
            <ChipGroup
              label="Position"
              options={POSITIONS.map((p) => ({ value: p, label: p }))}
              value={position}
              onChange={(v) => setPosition(v as Position)}
              columns={4}
            />
          </Field>

          <Field label="Scoring">
            <ChipGroup
              label="Scoring"
              options={SCORINGS.map((s) => ({ value: s, label: s }))}
              value={scoring}
              onChange={(v) => setScoring(v as Scoring)}
              columns={3}
            />
          </Field>

          <Field
            label="Ranking style"
            hint="Optional — tap a style to cycle its importance: 1 (least) to 3 (most), tap past 3 to clear."
          >
            {/* Stays a FilterChip (LV.11): multi-select, and each chip carries
                its own 1–3 weight. Not one-of-many, so not a segment. */}
            <div className="grid grid-cols-2 gap-1.5">
              {ANALYTICAL_STYLES.map((s) => {
                const weight = styleWeights[s.key] ?? 0
                const active = weight > 0
                return (
                  <FilterChip
                    key={s.key}
                    pressed={active}
                    onClick={() => cycleStyleWeight(s.key)}
                    title={s.description}
                    className="w-full justify-between px-2.5 text-left"
                  >
                    <span className="truncate">{s.label}</span>
                    {active && (
                      <span className="fs-num flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm bg-white/25 px-1 text-[10px]">
                        {weight}
                      </span>
                    )}
                  </FilterChip>
                )
              })}
            </div>
          </Field>

          <Field
            label="AI expert"
            hint="Optional — rank in a persona's voice and current stances."
          >
            {personas.isLoading ? (
              <div className="grid grid-cols-2 gap-1.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-btn-sm w-full" />
                ))}
              </div>
            ) : (
              /* Stays a FilterChip (LV.11): the field is Optional and starts
                 with **no persona chosen**, and tapping the chosen one clears
                 it. A segment asserts one item is always active. */
              <div className="grid grid-cols-2 gap-1.5">
                {(personas.data ?? []).map((p) => {
                  const active = persona === p.username
                  return (
                    <FilterChip
                      key={p.username}
                      pressed={active}
                      onClick={() =>
                        setPersona((cur) => (cur === p.username ? null : p.username))
                      }
                      className="w-full justify-center px-2.5"
                    >
                      <span className="truncate">{p.display_name}</span>
                    </FilterChip>
                  )
                })}
              </div>
            )}
          </Field>

          <Field label="Players">
            <ChipGroup
              label="Players"
              options={COUNTS.map((c) => ({ value: String(c), label: String(c) }))}
              value={String(count)}
              onChange={(v) => setCount(Number(v) as Count)}
              columns={5}
            />
          </Field>

          <div>
            <Button
              variant="blue"
              className="w-full"
              disabled={step === 'creating' || outOfGenerations}
              onClick={handleCreate}
            >
              {step === 'creating' ? (
                <>
                  <Icon name="star" className="animate-pulse" /> Creating list…
                </>
              ) : (
                <>
                  <Icon name="star" /> Create list
                </>
              )}
            </Button>
            {quota.data && quota.data.limit > 0 && (
              <p className="fs-num mt-2 text-center text-[11px] font-bold text-n-3">
                {quota.data.remaining} of {quota.data.limit} left today
              </p>
            )}
          </div>
          <p className="text-center text-[11px] font-medium text-n-3">
            You&apos;ll land on the list and watch the AI build it — a starting
            point, not an oracle. Fully editable.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <span className="block text-[12px] font-bold text-ink">{label}</span>
      {hint && <p className="mt-0.5 text-[11px] font-medium text-n-3">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

/**
 * Single-select picker — exactly one option is always chosen, so it is the
 * shared segment control rather than a chip row (LV.11).
 *
 * The grid arrives through `className`, not through an inline style:
 * `gridTemplateColumns` as an inline style was fine on a plain `div`, but the
 * handoff's critical note (see `ui/tabs.tsx`) is that inline styles on this
 * control outrank its `:hover` rule — so this file keeps *no* inline style at
 * all rather than leaving one for someone to extend with a colour. The three
 * column counts in use are literal classes so Tailwind's scanner emits them.
 */
const GRID_COLUMNS: Record<number, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
}

function ChipGroup({
  label,
  options,
  value,
  onChange,
  columns,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  columns: 3 | 4 | 5
}) {
  return (
    <Segment aria-label={label} className={cn('grid w-full', GRID_COLUMNS[columns])}>
      {options.map((opt) => (
        <SegmentItem
          key={opt.value}
          active={value === opt.value}
          onClick={() => onChange(opt.value)}
          className="w-full justify-center px-1.5"
        >
          <span className="truncate">{opt.label}</span>
        </SegmentItem>
      ))}
    </Segment>
  )
}
