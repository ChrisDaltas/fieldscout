'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { canCustomizeScoring } from '@/lib/scoring/custom-scoring-access'
import {
  DEFAULT_SCORING_PRESET,
  getScoringPreset,
  type ScoringRules,
} from '@/lib/scoring/default'
import {
  readPersonalScoringSystem,
  type ScoringSystemRow,
} from '@/lib/scoring/personal-scoring-system'
import {
  CUSTOM_DEFAULT_NAME,
  deriveInsight,
  parseRules,
  roundPoints,
  scoringSaveError,
  type ScoringMode,
} from '@/lib/scoring/scoring-editor'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * The personal scoring builder's state and actions (`/app/settings/scoring`)
 * — one editor behind the desktop page and the phone screen (gap list §4
 * item 101), so both read and save the same system the same way.
 *
 * System defaults (lib/scoring presets) are visible and selectable for
 * everyone, and so is editing values and saving a custom system while the
 * Pro rules are on hold (Chris, 2026-10-16 — `canCustomizeScoring`; it was
 * Pro-only, business rule 6). Custom systems persist to `scoring_systems`
 * through `PUT /api/scoring-systems` (RLS: owners manage their own rows).
 */
export function useScoringEditor() {
  const { user, profile, isLoading: isAuthLoading } = useAuth()
  const { toast } = useToast()
  const supabase = createBrowserClient()
  const queryClient = useQueryClient()

  const isPro = Boolean(profile?.is_pro)
  // Everyone while the Pro rules are on hold; Pro-only again if the switch
  // in custom-scoring-access.ts is flipped back.
  const canCustomize = canCustomizeScoring(isPro)

  // The user's saved custom system (one per user on this surface).
  const savedQuery = useQuery({
    queryKey: ['scoring-system', user?.id],
    enabled: Boolean(user),
    // The PERSONAL row only — never a league fork the user also owns
    // (R1335, F523; the same test the save uses).
    queryFn: (): Promise<ScoringSystemRow | null> => readPersonalScoringSystem(supabase, user!.id),
  })
  const savedSystem = savedQuery.data
  const isSystemLoading = savedQuery.isLoading

  const [mode, setMode] = useState<ScoringMode>(DEFAULT_SCORING_PRESET)
  const [name, setName] = useState(CUSTOM_DEFAULT_NAME)
  const [rules, setRules] = useState<ScoringRules>(() => ({
    ...getScoringPreset(DEFAULT_SCORING_PRESET).rules,
  }))

  // Seed the editor from the saved custom system once it loads — not from a
  // failed read (that is no answer), so a retry that succeeds still seeds.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || isSystemLoading || savedQuery.isError) return
    seeded.current = true
    if (savedSystem) {
      setMode('custom')
      setName(savedSystem.name)
      setRules(parseRules(savedSystem.rules))
    }
  }, [savedSystem, isSystemLoading, savedQuery.isError])

  const changeMode = (next: string) => {
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
  const changeRule = (key: keyof ScoringRules, value: number) => {
    setRules((prev) => ({ ...prev, [key]: roundPoints(value) }))
    if (mode !== 'custom') {
      setMode('custom')
      setName(savedSystem?.name ?? CUSTOM_DEFAULT_NAME)
    }
  }

  const save = useMutation({
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
        throw new Error(scoringSaveError(body))
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

  const reset = () => {
    const preset = getScoringPreset(DEFAULT_SCORING_PRESET)
    setMode(preset.id)
    setRules({ ...preset.rules })
  }

  return {
    canCustomize,
    savedSystem,
    /** The saved system couldn't be read (after React Query's retries). */
    loadFailed: savedQuery.isError,
    retryLoad: () => void savedQuery.refetch(),
    isPageLoading: isAuthLoading || !profile || isSystemLoading,
    mode,
    name,
    setName,
    rules,
    changeMode,
    changeRule,
    reset,
    save,
    insight: deriveInsight(rules),
    isFullPpr: rules.receptions === 1,
    showCustomOption: canCustomize || Boolean(savedSystem) || mode === 'custom',
    /** The name the custom choice goes by in the scoring-type list. */
    customLabel: savedSystem?.name ?? CUSTOM_DEFAULT_NAME,
  }
}
