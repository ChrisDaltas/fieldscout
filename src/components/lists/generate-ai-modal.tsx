'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Sparkles } from 'lucide-react'

import { AiPlayerRow } from '@/components/lists/ai-player-row'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { ANALYTICAL_STYLES } from '@/lib/claude/styles'
import { createBrowserClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { GenerateListResponse } from '@/types/schemas/ai'

const POSITIONS = ['Overall', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'] as const
const SCORINGS = ['PPR', 'Half-PPR', 'Standard'] as const
const COUNTS = [5, 10, 15, 25, 50] as const

type Position = (typeof POSITIONS)[number]
type Scoring = (typeof SCORINGS)[number]
type Count = (typeof COUNTS)[number]

type Step = 'form' | 'loading' | 'results' | 'saving'

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

export function GenerateAiModal({ open, onOpenChange }: GenerateAiModalProps) {
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const personas = usePersonaStyles(open)

  const [step, setStep] = useState<Step>('form')
  const [position, setPosition] = useState<Position>('WR')
  const [scoring, setScoring] = useState<Scoring>('PPR')
  const [style, setStyle] = useState<string>('Consensus')
  const [count, setCount] = useState<Count>(10)
  const [error, setError] = useState<string | null>(null)
  const [upgradeRequired, setUpgradeRequired] = useState(false)
  const [result, setResult] = useState<GenerateListResponse | null>(null)
  const [saveProgress, setSaveProgress] = useState(0)

  // Staleness guard: bumped on every open AND close so in-flight async work
  // from a previous dialog session can never mutate fresh state.
  const sessionRef = useRef(0)
  // Partial-save resume target: a retry adds the missing players to the SAME
  // list instead of creating a duplicate.
  const savedListRef = useRef<{ id: string; added: Set<string> } | null>(null)

  // Reset transient state on every open; invalidate stale handlers on close.
  useEffect(() => {
    sessionRef.current += 1
    if (open) {
      setStep('form')
      setError(null)
      setUpgradeRequired(false)
      setResult(null)
      setSaveProgress(0)
      savedListRef.current = null
    }
  }, [open])

  // The dialog must not be dismissable mid-save (Esc, overlay, X all route
  // through here in controlled mode) — a background save finishing after
  // dismissal would navigate/toast out of nowhere.
  const handleOpenChange = (next: boolean) => {
    if (!next && step === 'saving') return
    onOpenChange(next)
  }

  const handleGenerate = async () => {
    const session = sessionRef.current
    setStep('loading')
    setError(null)
    setUpgradeRequired(false)
    savedListRef.current = null
    try {
      const res = await fetch('/api/lists/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ position, scoring, style, player_count: count }),
      })
      if (sessionRef.current !== session) return
      if (res.status === 402) {
        setUpgradeRequired(true)
        setStep('form')
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null
        if (sessionRef.current !== session) return
        setError(
          typeof body?.error === 'string'
            ? body.error
            : 'Generation failed. Please try again.',
        )
        setStep('form')
        return
      }
      const data = (await res.json()) as GenerateListResponse
      if (sessionRef.current !== session) return
      setResult(data)
      setStep('results')
    } catch {
      if (sessionRef.current !== session) return
      setError('Generation failed. Please check your connection and try again.')
      setStep('form')
    }
  }

  const handleSave = async () => {
    if (!result) return
    const session = sessionRef.current
    const title = `${result.style} ${result.position} Top ${result.players.length}`.slice(0, 100)
    setError(null)
    setStep('saving')
    try {
      let listId = savedListRef.current?.id
      const addedIds = savedListRef.current?.added ?? new Set<string>()
      if (!listId) {
        const createRes = await fetch('/api/lists', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title,
            description: result.style_note.slice(0, 500),
            position_filter: result.position === 'Overall' ? undefined : result.position,
            ranking_mode: 'ranked',
          }),
        })
        if (!createRes.ok) throw new Error('Could not create the list.')
        const created = (await createRes.json()) as { id: string }
        listId = created.id
        savedListRef.current = { id: listId, added: addedIds }
      }

      // Sequential on purpose: player order = order added (business rule), and
      // the position counter must not race. 409 = already on the list (retry).
      setSaveProgress(addedIds.size)
      for (const player of result.players) {
        if (addedIds.has(player.player_id)) continue
        const res = await fetch(`/api/lists/${listId}/players`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            player_id: player.player_id,
            notes: player.rationale.slice(0, 280),
          }),
        })
        if (res.ok || res.status === 409) addedIds.add(player.player_id)
        if (sessionRef.current === session) setSaveProgress(addedIds.size)
      }
      if (sessionRef.current !== session) return

      queryClient.invalidateQueries({ queryKey: ['lists'] })
      const failed = result.players.length - addedIds.size
      toast(
        failed > 0
          ? {
              title: 'List saved with warnings',
              description: `${title} — ${addedIds.size} of ${result.players.length} players added.`,
              variant: 'destructive',
            }
          : {
              title: 'List saved',
              description: `${title} — ${addedIds.size} players. AI-assisted, fully editable.`,
            },
      )
      onOpenChange(false)
      router.push(`/app/lists/${listId}`)
    } catch (err) {
      if (sessionRef.current !== session) return
      setError(
        (err instanceof Error ? err.message : 'Saving failed.') +
          (savedListRef.current ? ' Retry to finish saving to the same list.' : ''),
      )
      setStep('results')
    }
  }

  const styleOptions: { value: string; label: string; hint?: string }[] = [
    ...ANALYTICAL_STYLES.map((s) => ({ value: s.label, label: s.label })),
    ...(personas.data ?? []).map((p) => ({
      value: p.username,
      label: p.display_name,
      hint: 'AI persona',
    })),
  ]

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

        {(step === 'form' || step === 'loading') && (
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

            <Field label="Ranking style">
              <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {styleOptions.map((opt) => {
                  const active = style === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setStyle(opt.value)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-left text-sm transition-colors',
                        active
                          ? 'border-foreground bg-bg-elevated-2 text-foreground'
                          : 'border-bg-elevated-2 bg-bg-elevated-3 text-text-secondary hover:border-bg-elevated-3 hover:text-foreground',
                      )}
                    >
                      <span>{opt.label}</span>
                      {opt.hint && (
                        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
                          {opt.hint}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
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
              disabled={step === 'loading'}
              onClick={handleGenerate}
            >
              {step === 'loading' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating — a few
                  seconds…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Generate
                </>
              )}
            </Button>
          </div>
        )}

        {(step === 'results' || step === 'saving') && result && (
          <div className="space-y-4">
            <p className="text-xs text-text-tertiary">
              {result.style} · {result.scoring} · a starting point, not an oracle —
              fully editable after saving.
            </p>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {result.players.map((p) => (
                <AiPlayerRow
                  key={p.player_id}
                  rank={p.rank}
                  name={p.player_name}
                  team={p.team}
                  rationale={p.rationale}
                />
              ))}
            </ul>
            <p className="text-xs italic text-text-secondary">{result.style_note}</p>
            {result.unresolved.length > 0 && (
              <p className="text-xs text-text-tertiary">
                Skipped {result.unresolved.length} unrecognized{' '}
                {result.unresolved.length === 1 ? 'name' : 'names'}.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="primary"
                className="flex-1 font-semibold"
                disabled={step === 'saving'}
                onClick={handleSave}
              >
                {step === 'saving' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving{' '}
                    {saveProgress}/{result.players.length}…
                  </>
                ) : (
                  'Save as New List'
                )}
              </Button>
              <Button
                disabled={step === 'saving'}
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </span>
      {children}
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
