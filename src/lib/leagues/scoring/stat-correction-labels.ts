/**
 * stat-correction-labels — the plain words a stat correction is announced in
 * (M6 L.E2.2, migration 172; spec §23.4 / §12.21; PROGRESS D453).
 *
 * The league post and the result notification are written by the scoring
 * door IN the re-score's transaction (TD6 / TD7), so the words live in SQL
 * (`stat_key_label_internal`, 172). This module is the ONE source they are
 * generated from — the registry's own labels (D33's one namespace), lower-
 * cased for a sentence ("Player X's receiving yards 97 → 95") — and
 * `stat-correction-labels.test.ts` fails if the SQL map and this ever
 * disagree, or if a key an event can carry has no words.
 *
 * An event can carry exactly the keys `ingestWeek`'s diff can move: every
 * column-stored registry key and every advanced key (`movedStatKeys`).
 */
import { STAT_KEYS } from '@/lib/leagues/stats/stat-keys'

/** A registry label as a sentence fragment: words lower-cased except an acronym ("TD", "FG", "D/ST"); "(Raw)" dropped. */
export function sentenceLabel(label: string): string {
  return label
    .replace(/ \(Raw\)$/, '')
    .split(' ')
    .map((word) => (/[A-Z]{2}/.test(word) ? word : word.toLowerCase()))
    .join(' ')
}

/** Every key a `stat_correction_events` row can carry → its words. */
export const CORRECTION_LABELS: ReadonlyMap<string, string> = new Map(
  STAT_KEYS.filter((def) => def.storage === 'column' || def.storage === 'advanced').map((def) => [def.key, sentenceLabel(def.label)]),
)

/** The words for one key — the SQL helper's own fallback for a key it does not know (never expected: the census pins the map). */
export function correctionLabel(statKey: string): string {
  return CORRECTION_LABELS.get(statKey) ?? statKey.replace(/_/g, ' ')
}
