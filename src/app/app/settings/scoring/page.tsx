'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PageHeader } from '@/components/layout/app-header'
import { AIInsight } from '@/components/ui/ai-insight'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { createBrowserClient } from '@/lib/supabase/client'
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
 * Scoring builder — outside-the-nav settings page (Back stroke button, no
 * active nav item). Two columns: Basic settings on the left, Scout AI read +
 * per-phase scoring cards on the right.
 *
 * System defaults (lib/scoring presets) are visible and selectable for
 * everyone; editing values and saving a custom system is Pro-only
 * (business rule 6). Custom systems persist to `scoring_systems`
 * (RLS: owners manage their own rows).
 */
export default function ScoringSettingsPage() {
  const router = useRouter()
  const { user, profile, isLoading: isAuthLoading } = useAuth()
  const { toast } = useToast()
  const supabase = createBrowserClient()
  const queryClient = useQueryClient()

  const isPro = Boolean(profile?.is_pro)

  // The user's saved custom system (one per user on this surface).
  const { data: savedSystem, isLoading: isSystemLoading } = useQuery({
    queryKey: ['scoring-system', user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<ScoringSystemRow | null> => {
      const { data, error } = await supabase
        .from('scoring_systems')
        .select('*')
        .eq('owner_id', user!.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return data
    },
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

  // Any value edit forks a preset into the custom system (Pro-only path —
  // the controls are disabled for free users).
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
      const payload = {
        name: name.trim() || CUSTOM_DEFAULT_NAME,
        rules: rules as unknown as Json,
        updated_at: new Date().toISOString(),
      }

      if (savedSystem) {
        const { data, error } = await supabase
          .from('scoring_systems')
          .update(payload)
          .eq('id', savedSystem.id)
          .select()
          .single()
        if (error) throw error
        return data
      }

      const { data, error } = await supabase
        .from('scoring_systems')
        .insert({ owner_id: user.id, ...payload })
        .select()
        .single()
      if (error) throw error
      return data
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
  const showCustomOption = isPro || Boolean(savedSystem) || mode === 'custom'
  const isPageLoading = isAuthLoading || !profile || isSystemLoading

  return (
    <div className="max-w-[880px]">
      <PageHeader title="Scoring" />

      <div className="mb-4">
        <Button variant="stroke" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      </div>

      {isPageLoading ? (
        <ScoringSkeleton />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.3fr]">
          {/* Left: basics + Pro moment */}
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Basic settings</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="scoring-name">System name</Label>
                  <Input
                    id="scoring-name"
                    value={mode === 'custom' ? name : getScoringPreset(mode).label}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    disabled={!isPro || mode !== 'custom'}
                  />
                  <p className="text-[11px] font-medium text-n-3">
                    {mode === 'custom'
                      ? 'Names your custom system across FieldScout.'
                      : 'Platform presets keep their own names.'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="scoring-type">Scoring type</Label>
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

                <div className="flex items-center gap-3 border-t border-n-4 pt-4">
                  <div className="mr-auto min-w-0">
                    <div className="text-[13px] font-bold leading-tight">
                      Full PPR
                    </div>
                    <div className="mt-0.5 text-[12px] font-medium text-n-3">
                      1 point per reception
                    </div>
                  </div>
                  <Switch
                    checked={isFullPpr}
                    onCheckedChange={(checked) =>
                      applyRuleChange('receptions', checked ? 1 : 0)
                    }
                    disabled={!isPro}
                    aria-label="Full PPR"
                  />
                </div>
              </CardContent>
            </Card>

            {!isPro && (
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
          <div className="flex flex-col gap-5">
            <AIInsight heading={insight.heading} confidence="medium">
              {insight.body}
            </AIInsight>

            {SCORING_GROUPS.map((group) => (
              <Card key={group.title}>
                <CardHeader>
                  <CardTitle>{group.title}</CardTitle>
                </CardHeader>
                <CardContent className="py-1">
                  {group.fields.map((field, i) => (
                    <ScoreRow
                      key={field.key}
                      field={field}
                      value={rules[field.key]}
                      isLast={i === group.fields.length - 1}
                      disabled={!isPro}
                      onChange={(value) => applyRuleChange(field.key, value)}
                    />
                  ))}
                </CardContent>
              </Card>
            ))}

            {isPro && (
              <div className="flex justify-end gap-2.5">
                <Button variant="stroke" size="sm" onClick={handleReset}>
                  <Icon name="reset" size={13} />
                  Reset to default
                </Button>
                <Button
                  variant="blue"
                  size="sm"
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
  isLast,
  disabled,
  onChange,
}: {
  field: StatFieldMeta
  value: number
  isLast: boolean
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <div
      className={`flex items-center gap-3 py-[7px] ${
        isLast ? '' : 'border-b border-n-4'
      }`}
    >
      <span className="mr-auto min-w-0 truncate text-[13px] font-bold">
        {field.label}
      </span>
      <span className="fs-overline shrink-0 text-n-3">{field.unit}</span>
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
          className={`fs-num min-w-11 text-center text-[13px] font-extrabold ${
            value < 0 ? 'text-negative-strong' : 'text-ink'
          }`}
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

/* -------------------------------- Skeleton ------------------------------- */

function ScoringSkeleton() {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.3fr]">
      <div className="flex flex-col gap-5">
        <Skeleton className="h-80" />
      </div>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-28" />
        <Skeleton className="h-52" />
        <Skeleton className="h-44" />
      </div>
    </div>
  )
}
