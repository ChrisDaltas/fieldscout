/**
 * The PERSONAL (research) scoring system — the one row the personal scoring
 * page (`/app/settings/scoring`) reads and `PUT /api/scoring-systems` saves.
 *
 * **Which rows are personal, and why this is the one test (PROGRESS D451(10),
 * R1335 — F523).** A commissioner's LEAGUE fork is a `scoring_systems` row he
 * owns too (`scoring_fork_template` inserts `owner_id = auth.uid()`), so the
 * page's old pick — "the user's newest row" — could read a league's rules as
 * his own and save over them (before 170 silently; since 170 the database
 * refuses it by name). A personal row is a row he owns whose `rules` carry NO
 * `format` member:
 *   - every league fork carries one — `format` is the league document
 *     envelope (`rules-doc.ts` ScoringRulesDocV2), and forking is the only
 *     way the app gives a league a user-owned row (templates are owned by no
 *     one);
 *   - the personal page never writes one — its documents are flat research
 *     coefficients (`src/lib/scoring/default.ts`), and the route refuses a
 *     `format` key (`PERSONAL_RULES_RESERVED_KEY`), so the partition holds
 *     for every row this surface ever writes;
 *   - it is a plain column read, so it answers the same on a database
 *     without migration 170 (deploy before push, TD15) and needs no second
 *     round trip. The league-use guard (170's `scoring_system_league_use_
 *     internal` + trigger) stays the backstop: a row attached to a league
 *     outside the app would still be refused loudly, never overwritten.
 *
 * No clock is read here: `updated_at` is passed in by the route.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

type Supabase = SupabaseClient<Database>
export type ScoringSystemRow = Database['public']['Tables']['scoring_systems']['Row']

/** The league document envelope's member — never a personal rules key. */
export const PERSONAL_RULES_RESERVED_KEY = 'format'

/** The user's newest PERSONAL scoring system, or null when he has none. A
 *  read error is thrown, never read as "no row" (CLAUDE.md). */
export async function readPersonalScoringSystem(supabase: Supabase, userId: string): Promise<ScoringSystemRow | null> {
  const { data, error } = await supabase
    .from('scoring_systems')
    .select('*')
    .eq('owner_id', userId)
    .is(`rules->${PERSONAL_RULES_RESERVED_KEY}`, null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export interface PersonalScoringSave {
  name: string
  rules: Record<string, number>
  updatedAt: string
}

export type PersonalScoringSaveResult =
  | { ok: true; status: 200 | 201; row: ScoringSystemRow }
  | { ok: false; status: 400 | 500; error: string }

/** Save the user's personal system: update his newest personal row, or
 *  create the first one. A league fork is never touched. */
export async function savePersonalScoringSystem(
  supabase: Supabase,
  userId: string,
  input: PersonalScoringSave,
): Promise<PersonalScoringSaveResult> {
  if (Object.prototype.hasOwnProperty.call(input.rules, PERSONAL_RULES_RESERVED_KEY)) {
    return {
      ok: false,
      status: 400,
      error: `"${PERSONAL_RULES_RESERVED_KEY}" is not a scoring rule — it marks a league scoring document, which is edited from the league's settings`,
    }
  }
  let existing: ScoringSystemRow | null
  try {
    existing = await readPersonalScoringSystem(supabase, userId)
  } catch (error) {
    return { ok: false, status: 500, error: (error as { message?: string }).message ?? String(error) }
  }
  const payload = { name: input.name, rules: input.rules as Json, updated_at: input.updatedAt }

  if (existing) {
    const { data, error } = await supabase
      .from('scoring_systems')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return { ok: false, status: 500, error: error.message }
    return { ok: true, status: 200, row: data }
  }

  const { data, error } = await supabase
    .from('scoring_systems')
    .insert({ owner_id: userId, ...payload })
    .select()
    .single()
  if (error) return { ok: false, status: 500, error: error.message }
  return { ok: true, status: 201, row: data }
}
