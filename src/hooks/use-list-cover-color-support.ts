'use client'

import { useQuery } from '@tanstack/react-query'

import { hasCoverColorColumn } from '@/lib/lists/cover-color'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Whether `lists.cover_color` exists here yet (migration 188). Main reaches
 * production before Chris pushes the migration, so the colour swatches only
 * show once the column is real.
 *
 * Reads one row with `select('*')` and looks for the key
 * (`hasCoverColorColumn`) — it never NAMES the column, because a read naming
 * a missing column answers HTTP 400 (42703) and would put an error in the
 * console and the Supabase logs on every open until the push.
 *
 * `false` = not pushed yet, OR no row is visible to look at (unknown is
 * treated as "not yet": the swatches simply aren't offered, and a list is
 * never created with a colour the database can't hold). A database error is
 * thrown; the caller sees no `true` and likewise hides the swatches.
 */
export async function probeCoverColorSupport(): Promise<boolean> {
  const supabase = createBrowserClient()
  const { data, error } = await supabase.from('lists').select('*').limit(1)
  if (error) throw error
  return hasCoverColorColumn(data?.[0])
}

/**
 * `probeCoverColorSupport` as a query, for the create forms (a NEW list has no
 * loaded row to check; Edit checks its own row instead).
 *
 * Kept outside the `['lists', …]` keys so list mutations don't re-probe.
 */
export function useListCoverColorSupport(enabled = true) {
  return useQuery({
    queryKey: ['list-cover-color-support'],
    enabled,
    // No polling: once five minutes stale it is asked again on the next mount
    // or window focus, so an open app picks up the push without a reload.
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: probeCoverColorSupport,
  })
}
