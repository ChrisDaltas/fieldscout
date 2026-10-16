'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PageHeader } from '@/components/layout/app-header'
import { AIInsight } from '@/components/ui/ai-insight'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import {
  DEFAULT_SCORING_PRESET,
  SCORING_PRESETS,
  getScoringPreset,
  type ScoringPresetId,
  type ScoringRules,
} from '@/lib/scoring/default'
import { canCustomizeScoring } from '@/lib/scoring/custom-scoring-access'
import { readPersonalScoringSystem } from '@/lib/scoring/personal-scoring-system'
import { createBrowserClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Database, Json } from '@/types/database'

type ScoringSystemRow = Database['public']['Tables']['scoring_systems']['Row']

/** The editor is either showing a platform preset or the user's custom system. */
type ScoringMode = ScoringPresetId | 'custom'

const CUSTOM_DEFAULT_NAME = 'My custom scoring'

/* ------------------------------ Rule groups ----------------------------- */

interface StatFieldMeta {
  key: keyof ScoringRules
  label: string
  unit: string
  step: number
}

/** Per-phase grouping of the real ScoringRules shape from lib/scoring. */
const SCORING_GROUPS: { title: string; fields: StatFieldMeta[] }[] = [
  {
    title: 'Passing',
    fields: [
      { key: 'pass_yards', label: 'Passing yards', unit: 'per yd', step: 0.01 },
      { key: 'pass_tds', label: 'Passing TD', unit: 'per TD', step: 1 },
      { key: 'interceptions', label: 'Interception', unit: 'per INT', step: 1 },
    ],
  },
  {
    title: 'Rushing',
    fields: [
      { key: 'rush_yards', label: 'Rushing yards', unit: 'per yd', step: 0.01 },
      { key: 'rush_tds', label: 'Rushing TD', unit: 'per TD', step: 1 },
    ],
  },
  {
    title: 'Receiving',
    fields: [
      { key: 'receptions', label: 'Reception', unit: 'per rec', step: 0.5 },
      {
        key: 'receiving_yards',
        label: 'Receiving yards',
        unit: 'per yd',
        step: 0.01,
      },
      { key: 'receiving_tds', label: 'Receiving TD', unit: 'per TD', step: 1 },
    ],
  },
  {
    title: 'Miscellaneous',
    fields: [
      { key: 'fumbles_lost', label: 'Fumble lost', unit: 'per fum', step: 1 },
      {
        key: 'two_point_conversions',
        label: '2-pt conversion',
        unit: 'per 2PC',
        step: 1,
      },
    ],
  },
  {
    title: 'Kicking',
    fields: [
      { key: 'fg_made', label: 'Field goal', unit: 'per FG', step: 1 },
      { key: 'fg_made_40_plus', label: 'Field goal 40+', unit: 'per FG', step: 1 },
      { key: 'fg_made_50_plus', label: 'Field goal 50+', unit: 'per FG', step: 1 },
      { key: 'xp_made', label: 'Extra point', unit: 'per XP', step: 1 },
    ],
  },
  {
    title: 'Defense',
    fields: [
      { key: 'def_sacks', label: 'Sack', unit: 'per sack', step: 1 },
      { key: 'def_interceptions', label: 'Interception', unit: 'per INT', step: 1 },
      {
        key: 'def_fumble_recoveries',
        label: 'Fumble recovery',
        unit: 'per FR',
        step: 1,
      },
      { key: 'def_tds', label: 'Defensive TD', unit: 'per TD', step: 1 },
      { key: 'def_safeties', label: 'Safety', unit: 'per safety', step: 1 },
    ],
  },
]

/* -------------------------------- Helpers ------------------------------- */

/** "+0.04", "+4", "-2" — mono-ready, no trailing zeros beyond the data. */
function formatPoints(value: number): string {
  const text = Number(value.toFixed(2)).toString()
  return value > 0 ? `+${text}` : text
}

/**
 * Coerce a stored `rules` Json blob into the full ScoringRules shape,
 * falling back to the platform default for any missing/invalid field.
 */
function parseRules(json: Json | null): ScoringRules {
  const base: ScoringRules = { ...getScoringPreset(DEFAULT_SCORING_PRESET).rules }
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const record = json as Record<string, unknown>
    for (const key of Object.keys(base) as (keyof ScoringRules)[]) {
      const value = record[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        base[key] = value
      }
    }
  }
  return base
}

/** A real read on the current values — which position group they push up. */
function deriveInsight(rules: ScoringRules): { heading: string; body: string } {
  const rec = rules.receptions
  if (rec >= 1) {
    return {
      heading: 'Your settings favor pass catchers',
      body: `${formatPoints(rec)} per reception on top of ${formatPoints(rules.receiving_yards)} per receiving yard rewards target volume — WRs and pass-catching RBs climb this board.`,
    }
  }
  if (rec > 0) {
    return {
      heading: 'Your settings are close to balanced',
      body: `${formatPoints(rec)} per reception splits the difference — rushing and receiving volume score about evenly, so draft the best player available.`,
    }
  }
  if (rules.pass_tds >= 6) {
    return {
      heading: 'Your settings favor QBs',
      body: `${formatPoints(rules.pass_tds)} per passing TD matches rushing scores with zero PPR — elite passers jump the queue in this format.`,
    }
  }
  return {
    heading: 'Your settings favor RBs',
    body: `No points per reception with ${formatPoints(rules.rush_tds)} per rushing TD makes carries king — early-down workhorses outscore possession receivers.`,
  }
}

/* --------------------------------- Page --------------------------------- */

/**
 * Scoring builder — outside-the-nav settings page (quiet Back button, no
 * active nav item), in the v7 Account settings language: 14px bold section
 * titles over hairline-bordered row groups. Two columns: Basic settings on
 * the left, Scout AI read + per-phase scoring groups on the right.
 *
 * System defaults (lib/scoring presets) are visible and selectable for
 * everyone, and so is editing values and saving a custom system while the
 * Pro rules are on hold (Chris, 2026-10-16 — `canCustomizeScoring`; it was
 * Pro-only, business rule 6). Custom systems persist to `scoring_systems`
 * (RLS: owners manage their own rows).
 */
export default function ScoringSettingsPage() {
  const router = useRouter()
  const { user, profile, isLoading: isAuthLoading } = useAuth()
  const { toast } = useToast()
  const supabase = createBrowserClient()
  const queryClient = useQueryClient()

  const isPro = Boolean(profile?.is_pro)
  // Everyone while the Pro rules are on hold; Pro-only again if the switch
  // in custom-scoring-access.ts is flipped back.
  const canCustomize = canCustomizeScoring(isPro)

  // The user's saved custom system (one per user on this surface).
  const { data: savedSystem, isLoading: isSystemLoading } = useQuery({
    queryKey: ['scoring-system', user?.id],
    enabled: Boolean(user),
    // The PERSONAL row only — never a league fork the user also owns
    // (R1335, F523; the same test the save uses).
    queryFn: (): Promise<ScoringSystemRow | null> => readPersonalScoringSystem(supabase, user!.id),
  })

  const [mode, setMode] = useState<ScoringMode>(DEFAULT_SCORING_PRESET)
  const [name, setName] = useState(CUSTOM_DEFAULT_NAME)
  const [rules, setRules] = useState<ScoringRules>(() => ({
    ...getScoringPreset(DEFAULT_SCORING_PRESET).rules,
  }))

  // Seed the editor from the saved custom system once it loads.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || isSystemLoading) return
    seeded.current = true
    if (savedSystem) {
      setMode('custom')
      setName(savedSystem.name)
      setRules(parseRules(savedSystem.rules))
    }
  }, [savedSystem, isSystemLoading])

  const handleModeChange = (next: string) => {
    if (next === 'custom') {
      setMode('custom')
      if (savedSystem) {
        setName(savedSystem.name)
        setRules(parseRules(savedSystem.rules))
      }
      return
    }
    const preset = getScoringPreset(next)
    setMode(preset.id)
    setRules({ ...preset.rules })
  }

  // Any value edit forks a preset into the custom system (the controls are
  // disabled only for an account that can't customize — see canCustomize).
  const applyRuleChange = (key: keyof ScoringRules, value: number) => {
    setRules((prev) => ({ ...prev, [key]: Math.round(value * 100) / 100 }))
    if (mode !== 'custom') {
      setMode('custom')
      setName(savedSystem?.name ?? CUSTOM_DEFAULT_NAME)
    }
  }

  const saveMutation = useMutation({
    mutationFn: async (): Promise<ScoringSystemRow> => {
      if (!user) throw new Error('You need to be signed in')
      // The gate + write live in the route handler, which reads the same
      // switch — access can't be enforced by the client alone.
      const res = await fetch('/api/scoring-systems', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || CUSTOM_DEFAULT_NAME,
          rules,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
          code?: string
        } | null
        throw new Error(
          body?.code === 'PRO_REQUIRED'
            ? 'Custom scoring is a Pro feature.'
            : body?.error || 'Could not save scoring',
        )
      }
      return (await res.json()) as ScoringSystemRow
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring-system', user?.id] })
      toast({ title: 'Scoring saved' })
    },
    onError: (error) => {
      toast({
        title: 'Could not save scoring',
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })

  const handleReset = () => {
    const preset = getScoringPreset(DEFAULT_SCORING_PRESET)
    setMode(preset.id)
    setRules({ ...preset.rules })
  }

  const insight = deriveInsight(rules)
  const isFullPpr = rules.receptions === 1
  const showCustomOption = canCustomize || Boolean(savedSystem) || mode === 'custom'
  const isPageLoading = isAuthLoading || !profile || isSystemLoading

  return (
    <div className="max-w-[880px]">
      <PageHeader title="Scoring" />

      <div className="mb-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      </div>

      {isPageLoading ? (
        <ScoringSkeleton />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.3fr]">
          {/* Left: basics + Pro moment */}
          <div className="flex flex-col gap-6">
            <ScoringSection title="Basic settings">
              <div className="flex flex-col gap-3 px-3.5 py-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="scoring-name" className={FIELD_LABEL}>
                    System name
                  </Label>
                  <Input
                    id="scoring-name"
                    value={mode === 'custom' ? name : getScoringPreset(mode).label}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    disabled={!canCustomize || mode !== 'custom'}
                  />
                  <p className="text-[10px] font-medium text-n-6">
                    {mode === 'custom'
                      ? 'Names your custom system across FieldScout.'
                      : 'Platform presets keep their own names.'}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="scoring-type" className={FIELD_LABEL}>
                    Scoring type
                  </Label>
                  <Select value={mode} onValueChange={handleModeChange}>
                    <SelectTrigger id="scoring-type">
                      <SelectValue placeholder="Pick a scoring system" />
                    </SelectTrigger>
                    <SelectContent>
                      {SCORING_PRESETS.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </SelectItem>
                      ))}
                      {showCustomOption && (
                        <>
                          <SelectSeparator />
                          <SelectItem value="custom">
                            {savedSystem?.name ?? CUSTOM_DEFAULT_NAME}
                          </SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex min-h-[44px] items-center gap-3.5 border-t border-n-4 px-3.5 py-[7px]">
                <div className="mr-auto flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-ink">
                    Full PPR
                  </span>
                  <span className="text-[10px] font-medium text-n-6">
                    1 point per reception
                  </span>
                </div>
                <Switch
                  checked={isFullPpr}
                  onCheckedChange={(checked) =>
                    applyRuleChange('receptions', checked ? 1 : 0)
                  }
                  disabled={!canCustomize}
                  aria-label="Full PPR"
                />
              </div>
            </ScoringSection>

            {!canCustomize && (
              <AIInsight heading="Custom scoring is a Pro tool.">
                <p>
                  Every platform preset is yours to use — Pro lets you tune
                  each value and save a system of your own.
                </p>
                <div className="mt-3">
                  <Button
                    variant="blue"
                    size="sm"
                    onClick={() => router.push('/app/settings/billing')}
                  >
                    <Icon name="star" size={13} />
                    Upgrade to Pro
                  </Button>
                </div>
              </AIInsight>
            )}
          </div>

          {/* Right: Scout AI read + per-phase scoring */}
          <div className="flex flex-col gap-6">
            <AIInsight heading={insight.heading} confidence="medium">
              {insight.body}
            </AIInsight>

            {SCORING_GROUPS.map((group) => (
              <ScoringSection key={group.title} title={group.title}>
                {group.fields.map((field) => (
                  <ScoreRow
                    key={field.key}
                    field={field}
                    value={rules[field.key]}
                    disabled={!canCustomize}
                    onChange={(value) => applyRuleChange(field.key, value)}
                  />
                ))}
              </ScoringSection>
            ))}

            {canCustomize && (
              <div className="flex justify-end gap-[5px]">
                <Button variant="stroke" size="md" onClick={handleReset}>
                  <Icon name="reset" size={13} />
                  Reset to default
                </Button>
                <Button
                  variant="blue"
                  size="md"
                  disabled={mode !== 'custom' || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  <Icon name="save" size={13} />
                  {saveMutation.isPending ? 'Saving…' : 'Save scoring'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------- Score row ------------------------------ */

function ScoreRow({
  field,
  value,
  disabled,
  onChange,
}: {
  field: StatFieldMeta
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="flex min-h-[38px] items-center gap-3 border-t border-n-4 px-3.5 py-[5px] first:border-t-0">
      <span className="mr-auto min-w-0 truncate text-[11px] font-semibold text-ink">
        {field.label}
      </span>
      <span className="shrink-0 text-[10px] font-medium text-n-6">
        {field.unit}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Decrease ${field.label}`}
          onClick={() => onChange(value - field.step)}
        >
          <Icon name="minus-circle" size={13} />
        </Button>
        <span
          className={cn(
            'fs-num min-w-11 text-center text-[12px] font-bold',
            value < 0 ? 'text-negative-strong' : 'text-ink',
          )}
        >
          {formatPoints(value)}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Increase ${field.label}`}
          onClick={() => onChange(value + field.step)}
        >
          <Icon name="plus-circle" size={13} />
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------ Section shell ---------------------------- */

const FIELD_LABEL = 'text-[11px] font-semibold leading-tight'

/** Settings section — 14px bold title over a hairline-bordered row group. */
function ScoringSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-[9px]">
      <h2 className="text-[14px] font-bold tracking-[-0.015em] text-ink">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-n-4 bg-white">
        {children}
      </div>
    </section>
  )
}

/* -------------------------------- Skeleton ------------------------------- */

function ScoringSkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.3fr]">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-64 rounded-2xl bg-surface-control" />
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-28 rounded-2xl bg-surface-control" />
        <Skeleton className="h-44 rounded-2xl bg-surface-control" />
        <Skeleton className="h-36 rounded-2xl bg-surface-control" />
      </div>
    </div>
  )
}
