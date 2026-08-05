'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

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
import { listsKeys } from '@/hooks/use-lists'
import { ANALYTICAL_STYLES } from '@/lib/claude/styles'
import { createBrowserClient } from '@/lib/supabase/client'
import { useAiBuildStore } from '@/stores/ai-build-store'
import { useAuthStore } from '@/stores/auth-store'
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
  persona_name: string
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
        .select('username, persona_name')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('persona_name')
      if (error) throw error
      return (data ?? []) as PersonaOption[]
    },
  })
}

/**
 * "Create with AI" — collects the brief, creates the (empty) list, queues the
 * AI build job, and immediately navigates to the List Detail page where the
 * user watches the AI add players and put them in order (useAiListBuild).
 * Scout AI surface: accent-blue moments, never lime.
 */
export function GenerateAiModal({ open, onOpenChange }: GenerateAiModalProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const personas = usePersonaStyles(open)
  const startBuild = useAiBuildStore((s) => s.start)
  const profile = useAuthStore((s) => s.profile)

  const [step, setStep] = useState<Step>('form')
  const [position, setPosition] = useState<Position>('WR')
  const [scoring, setScoring] = useState<Scoring>('PPR')
  /** Optional: style key → importance (1–3). Empty = no style bias. */
  const [styleWeights, setStyleWeights] = useState<Record<string, number>>({})
  /** Optional: selected persona username. Null = no AI expert. */
  const [persona, setPersona] = useState<string | null>(null)
  const [count, setCount] = useState<Count>(10)
  const [error, setError] = useState<string | null>(null)
  const [upgradeRequired, setUpgradeRequired] = useState(false)

  // Staleness guard: bumped on every open AND close so in-flight async work
  // from a previous dialog session can never mutate fresh state.
  const sessionRef = useRef(0)

  // Reset transient state on every open; invalidate stale handlers on close.
  useEffect(() => {
    sessionRef.current += 1
    if (open) {
      setStep('form')
      setError(null)
      setUpgradeRequired(false)
    }
  }, [open])

  // Don't allow dismissal mid-create (Esc, overlay, X all route through here
  // in controlled mode) — the create finishing after dismissal would navigate
  // out of nowhere.
  const handleOpenChange = (next: boolean) => {
    if (!next && step === 'creating') return
    onOpenChange(next)
  }

  const handleCreate = async () => {
    // Client-side Pro pre-check so free users get the pitch before an empty
    // list exists. Profile not loaded yet → proceed; the generate route is
    // the real gate and its 402 surfaces on the detail page.
    if (profile && !profile.is_pro) {
      setUpgradeRequired(true)
      return
    }
    const session = sessionRef.current
    setStep('creating')
    setError(null)
    try {
      // Mirrors the server's style label; the list is retitled after
      // generation anyway if resolution drops players.
      const personaName = persona
        ? (personas.data?.find((p) => p.username === persona)?.persona_name ?? persona)
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
      router.push(`/app/lists/${created.id}`)
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
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-ink bg-accent text-white">
              <Icon name="star" size={13} />
            </span>
            Generate with AI
          </DialogTitle>
        </DialogHeader>

        {upgradeRequired && (
          <div className="rounded-sm border border-ink bg-accent-soft p-4">
            <p className="text-[13px] font-bold text-ink">
              You need Pro for this one
            </p>
            <p className="mt-1 text-[13px] font-medium text-n-3">
              AI list generation is a Pro feature — upgrade and you can
              generate ranked lists in any style, instantly.
            </p>
            <Button asChild variant="blue" size="md" className="mt-3">
              <Link href="/app/settings/billing">Upgrade to Pro</Link>
            </Button>
          </div>
        )}

        {error && (
          <div className="rounded-sm border border-negative-strong bg-negative-soft p-3">
            <p className="text-[13px] font-bold text-ink">Could not create the list</p>
            <p className="mt-0.5 text-[13px] font-medium text-n-3">{error}</p>
          </div>
        )}

        <div className="space-y-5">
          <Field label="Position">
            <ChipGroup
              options={POSITIONS.map((p) => ({ value: p, label: p }))}
              value={position}
              onChange={(v) => setPosition(v as Position)}
              columns={4}
            />
          </Field>

          <Field label="Scoring">
            <ChipGroup
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
                      <span className="truncate">{p.persona_name}</span>
                    </FilterChip>
                  )
                })}
              </div>
            )}
          </Field>

          <Field label="Players">
            <ChipGroup
              options={COUNTS.map((c) => ({ value: String(c), label: String(c) }))}
              value={String(count)}
              onChange={(v) => setCount(Number(v) as Count)}
              columns={5}
            />
          </Field>

          <Button
            variant="blue"
            className="w-full"
            disabled={step === 'creating'}
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

/** Single-select chip row — FilterChips on a fixed grid. */
function ChipGroup({
  options,
  value,
  onChange,
  columns,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  columns: number
}) {
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => (
        <FilterChip
          key={opt.value}
          pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className="w-full justify-center px-1.5"
        >
          <span className="truncate">{opt.label}</span>
        </FilterChip>
      ))}
    </div>
  )
}
