'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useAiGenerationQuota } from '@/hooks/use-ai-generation-quota'
import { listsKeys } from '@/hooks/use-lists'
import { ANALYTICAL_STYLES } from '@/lib/claude/styles'
import { createBrowserClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useAiBuildStore } from '@/stores/ai-build-store'
import type { AnalyticalStyleKey, GenerateListRequest } from '@/types/schemas/ai'

import { useListsNav } from './lists-nav'

/**
 * FieldScout Mobile — "Create with AI" (AI list generation, which the design
 * lacks and CLAUDE.md says to keep and restyle). The same flow as the desktop
 * `GenerateAiModal`, in the design's sheet and chip language: create the list,
 * queue the build in `ai-build-store`, then land on the list, where the List
 * view claims the job (`useAiListBuild`) and narrates it. The POST route is the
 * real gate (daily quota); the quota read only says how many are left.
 */

const POSITIONS = ['Overall', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'] as const
const SCORINGS = ['PPR', 'Half-PPR', 'Standard'] as const
const COUNTS = [5, 10, 15, 25, 50] as const

type Position = (typeof POSITIONS)[number]
type Scoring = (typeof SCORINGS)[number]
type Count = (typeof COUNTS)[number]

interface PersonaOption {
  username: string
  display_name: string
}

/** Same query (and cache key) as the desktop modal's persona picker. */
function usePersonaStyles(enabled: boolean) {
  return useQuery({
    queryKey: ['ai-personas', 'styles'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PersonaOption[]> => {
      const { data, error } = await createBrowserClient()
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

export function AiCreateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const nav = useListsNav()
  const queryClient = useQueryClient()
  const personas = usePersonaStyles(open)
  const quota = useAiGenerationQuota(open)
  const startBuild = useAiBuildStore((s) => s.start)

  const [position, setPosition] = React.useState<Position>('WR')
  const [scoring, setScoring] = React.useState<Scoring>('PPR')
  const [weights, setWeights] = React.useState<Record<string, number>>({})
  const [persona, setPersona] = React.useState<string | null>(null)
  const [count, setCount] = React.useState<Count>(10)
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) setError(null)
  }, [open])

  const outOfGenerations = quota.data ? quota.data.remaining <= 0 : false
  const generationsOff = quota.data ? quota.data.limit <= 0 : false

  const create = async () => {
    if (outOfGenerations || creating) return
    setCreating(true)
    setError(null)
    try {
      const personaName = persona ? (personas.data?.find((p) => p.username === persona)?.display_name ?? persona) : null
      const hasWeights = Object.keys(weights).length > 0
      const styleLabel =
        personaName && hasWeights ? `${personaName} Blend` : (personaName ?? (hasWeights ? 'Custom Blend' : 'Consensus'))
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
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not create the list.')
      }
      const created = (await res.json()) as { id: string }
      const style_weights = Object.entries(weights).map(([key, weight]) => ({
        key: key as AnalyticalStyleKey,
        weight: weight as 1 | 2 | 3,
      }))
      const request: GenerateListRequest = {
        position,
        scoring,
        player_count: count,
        ...(persona ? { persona } : {}),
        ...(style_weights.length > 0 ? { style_weights } : {}),
      }
      startBuild(created.id, request)
      queryClient.invalidateQueries({ queryKey: listsKeys.all })
      onOpenChange(false)
      nav.openList(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the list.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <MobileSheet
      bodyClassName="leading-[normal] tabular-nums"
      open={open}
      onOpenChange={(next) => {
        if (!next && creating) return
        onOpenChange(next)
      }}
      title="Create with AI"
      subtitle="Scout AI builds a ranked list you can edit"
      showClose
      footer={
        <div className="flex flex-col gap-2 px-4 pt-2.5">
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating || outOfGenerations}
            className={cn(
              'flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-semibold',
              outOfGenerations ? 'bg-m-b3s text-m-t3' : 'bg-accent text-white active:bg-accent-strong',
            )}
          >
            {creating ? 'Creating list…' : 'Create list'}
          </button>
          {quota.data && quota.data.limit > 0 && (
            <p className="text-center text-[11px] font-semibold tabular-nums text-m-t3">
              {quota.data.remaining} of {quota.data.limit} left today
            </p>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3.5 px-4 pb-2">
        {outOfGenerations && quota.data && (
          <div className="rounded-[14px] bg-m-b1 px-3.5 py-3">
            <p className="text-[13px] font-semibold text-m-t1">
              {generationsOff
                ? 'AI generation is paused right now'
                : `That's your ${quota.data.limit} AI ${quota.data.limit === 1 ? 'list' : 'lists'} for today`}
            </p>
            <p className="mt-1 text-[12px] font-medium leading-[1.4] text-m-t3">
              {generationsOff
                ? 'It will be back shortly. Building a list by hand works exactly as always.'
                : `You get ${quota.data.limit} more when the day rolls over at midnight UTC — and you can build a list by hand any time.`}
            </p>
          </div>
        )}
        {error && (
          <div className="rounded-[14px] bg-m-gr px-3.5 py-3">
            <p className="text-[13px] font-semibold text-m-tr">Could not create the list</p>
            <p className="mt-1 text-[12px] font-medium leading-[1.4] text-m-t2">{error}</p>
          </div>
        )}

        <Group label="Position">
          {POSITIONS.map((p) => (
            <Choice key={p} on={position === p} onClick={() => setPosition(p)}>
              {p === 'DEF' ? 'D/ST' : p}
            </Choice>
          ))}
        </Group>
        <Group label="Scoring">
          {SCORINGS.map((s) => (
            <Choice key={s} on={scoring === s} onClick={() => setScoring(s)}>
              {s}
            </Choice>
          ))}
        </Group>
        <Group label="Ranking style" hint="Optional. Tap to weight a style 1 to 3; tap past 3 to clear.">
          {ANALYTICAL_STYLES.map((style) => {
            const weight = weights[style.key] ?? 0
            return (
              <Choice
                key={style.key}
                on={weight > 0}
                onClick={() =>
                  setWeights((prev) => {
                    const next = ((prev[style.key] ?? 0) + 1) % 4
                    const copy = { ...prev }
                    if (next === 0) delete copy[style.key]
                    else copy[style.key] = next
                    return copy
                  })
                }
              >
                {style.label}
                {weight > 0 && (
                  <span className="ml-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-accent px-1 text-[11px] font-bold tabular-nums text-white">
                    {weight}
                  </span>
                )}
              </Choice>
            )
          })}
        </Group>
        {(personas.data?.length ?? 0) > 0 && (
          <Group label="AI expert" hint="Optional. Rank in a persona's voice and current stances.">
            {(personas.data ?? []).map((p) => (
              <Choice
                key={p.username}
                on={persona === p.username}
                onClick={() => setPersona((cur) => (cur === p.username ? null : p.username))}
              >
                {p.display_name}
              </Choice>
            ))}
          </Group>
        )}
        <Group label="Players">
          {COUNTS.map((c) => (
            <Choice key={c} on={count === c} onClick={() => setCount(c)}>
              {c}
            </Choice>
          ))}
        </Group>
        <p className="text-center text-[12px] font-medium leading-[1.4] text-m-t3">
          You&apos;ll land on the list and watch the AI build it — a starting point, not an oracle. Fully editable.
        </p>
      </div>
    </MobileSheet>
  )
}

function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-m-t3">{label}</span>
      {hint ? <span className="-mt-1 text-[11px] font-medium text-m-t3">{hint}</span> : null}
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

/** Wizard choice chip (lr-frame §2.13.11 d): 34px, ink when chosen. */
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex h-[34px] items-center rounded-pill px-3.5 text-[13px] font-semibold',
        on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1 active:bg-m-b2h',
      )}
    >
      {children}
    </button>
  )
}
