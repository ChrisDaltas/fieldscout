/**
 * stat-correction-labels.test.ts — M6 L.E2.2 (migration 172; PROGRESS D453):
 * the words a correction is announced in, the worker's deploy-before-push
 * reading of the door's report, and reconcile naming the event behind a
 * locked week's moved line (F268's last half). Pure — no database.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ADVANCED_KEYS as INGEST_ADVANCED_KEYS, STAT_KEY_BY_COLUMN } from '@/lib/sync/ingest-week'

import { classifyLockedCell, correctionEventsWords, postLockEvents } from './reconcile'
import { correctionsStorageOf, type DoorReport, MISSING_CORRECTIONS_REPORT } from './score-week-worker'
import { CORRECTION_LABELS, correctionLabel, sentenceLabel } from './stat-correction-labels'

const MIGRATION = readFileSync(path.join(process.cwd(), 'supabase/migrations/172_league_stat_corrections.sql'), 'utf8')

/** 172's `stat_key_label_internal` CASE arms, as written in the migration file. */
function sqlLabels(): Map<string, string> {
  const body = MIGRATION.slice(MIGRATION.indexOf('CREATE OR REPLACE FUNCTION stat_key_label_internal'), MIGRATION.indexOf('REVOKE EXECUTE ON FUNCTION stat_key_label_internal'))
  const out = new Map<string, string>()
  for (const m of body.matchAll(/WHEN '([a-z0-9_]+)' THEN '((?:[^']|'')*)'/g)) out.set(m[1], m[2].replace(/''/g, "'"))
  return out
}

describe('the plain words of a stat key (the league post, the notification, the corrections view)', () => {
  it('the SQL map in 172 is exactly the registry-generated map — no key missing, none extra, no word different', () => {
    expect(Object.fromEntries(sqlLabels())).toEqual(Object.fromEntries(CORRECTION_LABELS))
  })
  it('every key an event can carry has words: every column key the ingest diff moves, every advanced key', () => {
    const eventKeys = [...STAT_KEY_BY_COLUMN.values(), ...INGEST_ADVANCED_KEYS]
    expect(eventKeys.length).toBeGreaterThan(30)
    for (const key of eventKeys) expect(CORRECTION_LABELS.has(key), key).toBe(true)
  })
  it('a registry label becomes a sentence fragment — lower case, acronyms kept, "(Raw)" dropped (stored literals)', () => {
    expect(sentenceLabel('Receiving Yards')).toBe('receiving yards')
    expect(sentenceLabel('PAT Made')).toBe('PAT made')
    expect(sentenceLabel('Return TD (D/ST)')).toBe('return TD (D/ST)')
    expect(sentenceLabel('Points Allowed (Raw)')).toBe('points allowed')
    expect(correctionLabel('receiving_yards')).toBe('receiving yards')
    expect(correctionLabel('not_a_key')).toBe('not a key')
  })
})

describe('F529 — a door report without corrections is a plain failure (the pre-172 arm retired)', () => {
  const door158: DoorReport = {
    league_id: 'L', season: 2026, week: 3, mode: 'h2h', received: 1, writable: 1, written: 1, unchanged: 0, skipped: [], reason: null,
    player_points: { teams_sent: 1, teams_written: 1, rows_written: 1, rows_removed: 0 },
  }
  const corrections = (recorded: number): DoorReport['corrections'] => ({
    teams_sent: 1, events_sent: 1, recorded, records: [], skipped: [], results_final: true, post: null, notified: [], not_notified: [], reason: recorded > 0 ? null : 'nothing_recorded',
  })
  it('nothing sent ⇒ none_sent, whatever the door is', () => {
    expect(correctionsStorageOf(0, door158)).toBe('none_sent')
    expect(correctionsStorageOf(0, { ...door158, corrections: corrections(0) })).toBe('none_sent')
  })
  it('sent, and the report carries no corrections ⇒ throws by name (never a quiet "not recorded")', () => {
    expect(() => correctionsStorageOf(2, door158)).toThrow(MISSING_CORRECTIONS_REPORT)
  })
  it('sent to a 172 door ⇒ recorded, or nothing_recorded (the door says why)', () => {
    expect(correctionsStorageOf(1, { ...door158, corrections: corrections(1) })).toBe('recorded')
    expect(correctionsStorageOf(1, { ...door158, corrections: corrections(0) })).toBe('nothing_recorded')
  })
})

describe('F268 — reconcile names the stat correction behind a locked week’s moved line', () => {
  const rows = [
    { league_id: 'L', season: 2026, week: 1, team_id: 'T', slot: 'wr:0', player_id: 'w1', points: 12, pending: [], reason: 'scored' as const, source: 'worker' as const },
  ]
  const today = {
    team_id: 'T', points: 14, pending: [], no_stat_row: [],
    starters: [{ player_id: 'w1', position: 'WR', points: 14, pending: [], reason: 'scored' as const }],
  }
  const event = { stat_key: 'receiving_yards', old_value: 120, new_value: 140, detected_at: '2026-10-02T11:00:00+00:00', week_state: 'final' as const }
  it('the moved line carries its event: key, old → new, when it was seen', () => {
    const v = classifyLockedCell(12, rows, today, { byPlayer: new Map([['w1', [event]]]), available: true })
    expect(v.map((x) => [x.kind, x.severity])).toEqual([['post_window_correction', 'info']])
    expect(v[0].explanation).toContain("w1 (wr:0) stored 12, today's stats 14 — the stat correction behind it: receiving_yards 120 → 140 (seen 2026-10-02T11:00:00+00:00)")
  })
  it('no event recorded for him ⇒ said so; the table absent ⇒ said so; no events argument ⇒ the 158 sentence unchanged', () => {
    expect(classifyLockedCell(12, rows, today, { byPlayer: new Map(), available: true })[0].explanation).toContain('no stat correction was recorded for him')
    expect(classifyLockedCell(12, rows, today, { byPlayer: new Map(), available: false })[0].explanation).toContain('predates migration 167')
    expect(classifyLockedCell(12, rows, today)[0].explanation).toContain("w1 (wr:0) stored 12, today's stats 14 — a correction")
  })
  it('R1344 only a POST-LOCK event is cited — week_state final, or seen at / after this league finalized the week; an in-window event (already in the stored points) never is', () => {
    const inWindow = { ...event, week_state: 'open' as const, detected_at: '2026-09-30T15:00:00+00:00' }
    const openElsewhere = { ...event, week_state: 'open' as const, detected_at: '2026-10-02T12:00:00+00:00' }
    expect(postLockEvents([inWindow, event], '2026-10-02T01:05:00+00:00')).toEqual([event])
    expect(postLockEvents([inWindow, openElsewhere], '2026-10-02T01:05:00+00:00')).toEqual([openElsewhere])
    expect(postLockEvents([inWindow], null)).toEqual([])
  })
  it('the words for several events', () => {
    expect(correctionEventsWords([event, { ...event, stat_key: 'receptions', old_value: 5, new_value: 6 }], true)).toBe(
      'the stat corrections behind it: receiving_yards 120 → 140 (seen 2026-10-02T11:00:00+00:00), receptions 5 → 6 (seen 2026-10-02T11:00:00+00:00)',
    )
  })
})
