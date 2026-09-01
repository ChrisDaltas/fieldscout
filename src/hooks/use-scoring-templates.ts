'use client'

import { useQuery } from '@tanstack/react-query'

import type { ScoringTemplateRow } from '@/components/leagues/scoring-template-picker-ops'
import { createBrowserClient } from '@/lib/supabase/client'

export const scoringTemplatesKeys = {
  all: ['scoring-templates'] as const,
}

/**
 * The 7 shipped template rows — Scout Scoring (SC.1, migration 106) + the 6
 * v1 parity rows (M1 task L.A2.3; spec §7.3.3 / App B).
 *
 * Reads the REAL seeded rows — `scoring_systems` WHERE `is_template = TRUE`
 * over migration 058's "Templates viewable by everyone" SELECT policy, which
 * is world-readable including anon (the picker is a pre-auth-capable
 * surface; no auth dependency here). Display order is applied client-side
 * by `buildTemplateCards` (§7.3.3 table order), so no ORDER BY is needed.
 *
 * Templates are seed data (immutable outside migrations), so a long
 * staleTime avoids refetch churn while the picker stays mounted in the
 * wizard/settings panel.
 *
 * `enabled` (SC.3): the create modal and the mock-launch dialog resolve the
 * §7.3.3 Scout preselection from this query at their own top level, and
 * both are mounted closed on pages the user may never open them from — the
 * gate keeps the fetch from firing until the dialog actually opens.
 * Defaults to true (every other caller is a mounted picker surface).
 */
export function useScoringTemplates(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: scoringTemplatesKeys.all,
    enabled: options?.enabled ?? true,
    queryFn: async (): Promise<ScoringTemplateRow[]> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('scoring_systems')
        .select('id, name, description, rules')
        .eq('is_template', true)

      if (error) throw error
      return data.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        // 058 seeds rules as a flat { stat_key: coefficient } object; the
        // ops layer additionally guards every read with a typeof check.
        rules: row.rules as Record<string, number>,
      }))
    },
    staleTime: 5 * 60 * 1000,
  })
}
