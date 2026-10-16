/**
 * The commissioner note — read and write (gap list #13; Chris 2026-10-15;
 * migration 192; spec v2.16.92).
 *
 * `GET  /api/leagues/[id]/commish/note` — ANY member reads it (the `leagues`
 * SELECT policy is member-only, §12.1). Membership is asserted FIRST
 * (`assertLeagueMember`), so a non-member gets the family's one no-leak 403
 * and never an empty "no note" (CLAUDE.md: assert the reason for emptiness).
 *
 * `POST /api/leagues/[id]/commish/note` — `commish_set_league_note`: the
 * commissioner or a co-commissioner sets (or, with an empty note, clears) it.
 * The whole verb is the RPC's — the gate, the trim and the cap, the no-op by
 * value, the receipt League Home's activity shows, the members'
 * notifications — in one transaction under the league row lock.
 *
 * DEPLOY BEFORE PUSH. Merged code reaches fieldscout.gg before Chris pushes
 * 192, so the read answers `available: false` (200) when the columns do not
 * exist yet (42703, anchored on the column's name), and the write answers a
 * named 503 when the door is missing (PGRST202 — `isDoorNotPushed`). Any
 * other error is loud (500 / the family mapping), never a quiet "no note".
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { isDoorNotPushed, type PostgrestErrorLike } from '@/lib/supabase/postgrest-errors'
import type { Database, Json } from '@/types/database'

import { LEAGUE_NOTE_MAX, noteLength, trimNote } from '../league-note-text'
import { optionalReason } from './commish-matchup-service'
import { mapInSeasonRpcError } from './inseason-errors'
import { INSEASON_LEAGUE_GONE_MESSAGE, assertLeagueMember } from './inseason-reads'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

/** The 42501 arm — one no-leak string for "no such league" and "not a
 *  commissioner" alike. */
export const LEAGUE_NOTE_FORBIDDEN_MESSAGE =
  'Only this league’s commissioner or a co-commissioner can change the commissioner note.'

/** The 503 while migration 192 is not on this database. */
export const LEAGUE_NOTE_NOT_LIVE_MESSAGE =
  'Commissioner notes aren’t switched on yet — they arrive with the next update.'

/** The 400 for a note over the cap (after trimming). */
export const LEAGUE_NOTE_TOO_LONG_MESSAGE = `Keep the note to ${LEAGUE_NOTE_MAX} characters or fewer.`

/** What the league home reads. */
export interface LeagueNoteView {
  /** False on a database without migration 192 — no note can exist yet, and
   *  the editor stays hidden. */
  available: boolean
  /** Null = no note pinned. */
  note: {
    text: string
    updated_at: string | null
    /** Who last set it — null if that account is gone. */
    author: { id: string; username: string | null } | null
  } | null
}

/** 192's result document (returned whole by the POST). */
export interface SetLeagueNoteResult {
  league_id: string
  verb: 'commish_set_league_note'
  action_type: 'set_league_note'
  note: string | null
  previous_note: string | null
  cleared: boolean
  updated_at: string | null
  updated_by: string | null
  /** The same note again (or clearing an empty one) writes nothing. */
  no_changes: boolean
  no_changes_why: string | null
  /** The receipt; null exactly when `no_changes`. */
  commissioner_action_id: string | null
  /** Members notified — on a set, an edit or a clear; 0 for a no-op. */
  notified: number
  notified_why?: string | null
  reason: string | null
  evaluated_at: string
}

/** `POST …/commish/note` — `{ note, reason? }`. An empty note clears it. */
export const setLeagueNoteInputSchema = z.strictObject({
  note: z
    .string()
    .max(LEAGUE_NOTE_MAX * 8)
    .transform(trimNote)
    .refine((text) => noteLength(text) <= LEAGUE_NOTE_MAX, { message: LEAGUE_NOTE_TOO_LONG_MESSAGE }),
  reason: optionalReason,
})
export type SetLeagueNoteInput = z.infer<typeof setLeagueNoteInputSchema>

/** The note columns are absent — 192 not pushed (42703, anchored on the name). */
export function isMissingNoteColumns(error: PostgrestErrorLike | null | undefined): boolean {
  return Boolean(error) && error!.code === '42703' && /leagues\.commissioner_note/.test(error!.message ?? '')
}

/** GET — the league's note, for any member. */
export async function readLeagueNote(supabase: Supabase, leagueId: string): Promise<ServiceResult> {
  const gate = await assertLeagueMember(supabase, leagueId)
  if (gate) return gate

  const { data, error } = await supabase
    .from('leagues')
    .select('commissioner_note, commissioner_note_updated_at, commissioner_note_updated_by')
    .eq('id', leagueId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    if (isMissingNoteColumns(error)) {
      const view: LeagueNoteView = { available: false, note: null }
      return { status: 200, body: view as unknown as Json }
    }
    return { status: 500, body: { error: `leagues: ${error.message}` } }
  }
  // Membership passed a moment ago; a row gone now was deleted in between.
  if (!data) return { status: 404, body: { error: INSEASON_LEAGUE_GONE_MESSAGE } }

  if (data.commissioner_note === null) {
    const view: LeagueNoteView = { available: true, note: null }
    return { status: 200, body: view as unknown as Json }
  }

  let author: { id: string; username: string | null } | null = null
  if (data.commissioner_note_updated_by) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', data.commissioner_note_updated_by)
      .maybeSingle()
    if (profileError) return { status: 500, body: { error: `profiles: ${profileError.message}` } }
    author = { id: data.commissioner_note_updated_by, username: profile?.username ?? null }
  }
  const view: LeagueNoteView = {
    available: true,
    note: { text: data.commissioner_note, updated_at: data.commissioner_note_updated_at, author },
  }
  return { status: 200, body: view as unknown as Json }
}

/** POST — set or clear the note (`commish_set_league_note`). */
export async function setLeagueNote(supabase: Supabase, leagueId: string, rawBody: unknown): Promise<ServiceResult> {
  const parsed = setLeagueNoteInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: z.flattenError(parsed.error) as unknown as Json } }
  }
  const { note, reason } = parsed.data

  // 192's order: (league, note, reason). An absent reason is OMITTED.
  const { data, error } = await supabase.rpc('commish_set_league_note', {
    p_league_id: leagueId,
    p_note: note,
    ...(reason === undefined ? {} : { p_reason: reason }),
  })
  if (error) {
    if (isDoorNotPushed(error, { commish_set_league_note: ['p_league_id', 'p_note', 'p_reason'] })) {
      return { status: 503, body: { error: LEAGUE_NOTE_NOT_LIVE_MESSAGE } }
    }
    return mapInSeasonRpcError(error, LEAGUE_NOTE_FORBIDDEN_MESSAGE)
  }

  // The answer must be this verb's, for this league — never a 200 for a
  // document that says something else happened.
  const result = (data ?? {}) as { verb?: unknown; league_id?: unknown }
  if (result.verb !== 'commish_set_league_note' || String(result.league_id).toLowerCase() !== leagueId.toLowerCase()) {
    return { status: 500, body: { error: 'The note change could not be confirmed — reload the league and check it.' } }
  }
  return { status: 200, body: data as Json }
}
