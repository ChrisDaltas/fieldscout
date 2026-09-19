'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * 129's per-key IN-SEASON POLICY TABLE, read — M6A task L.E1.13 item 3
 * (PROGRESS D360(5)/(10): *"the settings panel reads `commish_setting_policy`
 * for its refused copy"*). `commish_setting_policy(p_key)` is IMMUTABLE,
 * reads no table, writes nothing, and is EXECUTE-granted to `authenticated`
 * (129:354) for exactly this reader. The table is DATA in the database; the
 * panel never mirrors it, so a future migration that moves a key between
 * classes moves the panel with it.
 *
 * One call per key (the function is scalar), all in parallel, ONCE: the
 * result is a pure function of the key, so it is cached for the session
 * (`staleTime: Infinity`) and shared by every league. Mounted only while a
 * commissioner is in override mode on an in-season league (`enabled`).
 *
 * LOUD, never partial (CLAUDE.md): if ANY key's read fails the whole query
 * fails — a partial table would render an un-read key as "changeable". A
 * NULL row (129's answer for a key its catalog does not define) is carried
 * as `null`, never invented as `free`.
 */
/** One row of 129's policy table, as `commish_setting_policy(key)` returns it. */
export interface SettingPolicy {
  storage: 'column' | 'blob'
  class: 'free' | 'rescore' | 'bracket' | 'refused'
  refused_why: string | null
}

/** Keyed by setting key. `null` = 129's table does not define the key (the
 *  verb refuses it by name — the panel does not pre-judge it). */
export type SettingPolicies = Readonly<Record<string, SettingPolicy | null>>

export const commishSettingPolicyKeys = {
  table: (keys: readonly string[]) => ['commish-setting-policy', [...keys].sort().join(',')] as const,
}

function isPolicy(value: unknown): value is SettingPolicy {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    (v.storage === 'column' || v.storage === 'blob') &&
    (v.class === 'free' || v.class === 'rescore' || v.class === 'bracket' || v.class === 'refused') &&
    (v.refused_why === null || typeof v.refused_why === 'string')
  )
}

export function useCommishSettingPolicies(keys: readonly string[], enabled: boolean) {
  return useQuery({
    queryKey: commishSettingPolicyKeys.table(keys),
    enabled: enabled && keys.length > 0,
    staleTime: Infinity,
    queryFn: async (): Promise<SettingPolicies> => {
      const supabase = createBrowserClient()
      const rows = await Promise.all(
        keys.map(async (key) => {
          const { data, error } = await supabase.rpc('commish_setting_policy', { p_key: key })
          if (error) throw new Error(`commish_setting_policy(${key}): ${error.message}`)
          if (data !== null && !isPolicy(data)) throw new Error(`commish_setting_policy(${key}): an unreadable policy row`)
          return [key, data as SettingPolicy | null] as const
        }),
      )
      return Object.fromEntries(rows)
    },
  })
}
