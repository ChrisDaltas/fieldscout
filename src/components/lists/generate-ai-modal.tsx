'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { listsKeys } from '@/hooks/use-lists'
import { ANALYTICAL_STYLES } from '@/lib/claude/styles'
import { createBrowserClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
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
 * AI build job, and immediately navigates to the List Detail page where the
 * user watches the AI add players and put them in order (useAiListBuild).
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-bg-elevated-2 bg-bg-elevated sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Generate with AI
          </DialogTitle>
        </DialogHeader>

        {upgradeRequired && (
          <div className="rounded-md border border-bg-elevated-3 bg-bg-elevated-2 p-4 text-sm">
            <p className="font-semibold">FieldScout Pro required</p>
            <p className="mt-1 text-text-secondary">
              AI list generation is a Pro feature. Upgrade to generate ranked
              lists in any style, instantly.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-5">
          <Field label="Position">
            <PillGroup
              options={POSITIONS.map((p) => ({ value: p, label: p }))}
              value={position}
              onChange={(v) => setPosition(v as Position)}
              columns={4}
            />
          </Field>

          <Field label="Scoring">
            <PillGroup
              options={SCORINGS.map((s) => ({ value: s, label: s }))}
              value={scoring}
              onChange={(v) => setScoring(v as Scoring)}
              columns={3}
            />
          </Field>

          <Field
            label="Ranking Style"
            hint="Optional — tap a style to cycle its importance: 1 (least) to 3 (most), tap past 3 to clear."
          >
            <div className="grid grid-cols-2 gap-1.5">
              {ANALYTICAL_STYLES.map((s) => {
                const weight = styleWeights[s.key] ?? 0
                const active = weight > 0
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => cycleStyleWeight(s.key)}
                    title={s.description}
                    className={cn(
                      'flex items-center justify-between gap-1.5 rounded-full px-3 py-1.5 text-left text-xs font-semibold transition-colors',
                      active
                        ? 'bg-foreground text-background'
                        : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
                    )}
                  >
                    <span className="truncate">{s.label}</span>
                    {active && (
                      <span className="shrink-0 rounded-full bg-background/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                        {weight}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="AI Expert" hint="Optional — rank in a persona's voice and current stances.">
            {personas.isLoading ? (
              <p className="text-xs text-text-tertiary">Loading experts…</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {(personas.data ?? []).map((p) => {
                  const active = persona === p.username
                  return (
                    <button
                      key={p.username}
                      type="button"
                      onClick={() =>
                        setPersona((cur) => (cur === p.username ? null : p.username))
                      }
                      className={cn(
                        'truncate rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                        active
                          ? 'bg-foreground text-background'
                          : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
                      )}
                    >
                      {p.display_name}
                    </button>
                  )
                })}
              </div>
            )}
          </Field>

          <Field label="Players">
            <PillGroup
              options={COUNTS.map((c) => ({ value: String(c), label: String(c) }))}
              value={String(count)}
              onChange={(v) => setCount(Number(v) as Count)}
              columns={5}
            />
          </Field>

          <Button
            variant="primary"
            className="w-full font-semibold"
            disabled={step === 'creating'}
            onClick={handleCreate}
          >
            {step === 'creating' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Creating list…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Create List
              </>
            )}
          </Button>
          <p className="text-center text-[11px] text-text-tertiary">
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
      <span className="block text-xs font-semibold text-text-secondary">{label}</span>
      {hint && <p className="mt-0.5 text-[11px] text-text-tertiary">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function PillGroup({
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
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
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
  )
}
