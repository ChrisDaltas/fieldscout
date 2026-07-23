/**
 * Scoring-template-picker ops (M1 task L.A2.3; spec §7.3.3, §16.2, App B).
 *
 * Pure derivation layer for `scoring-template-picker.tsx` — every displayed
 * compare value is DERIVED from a template row's `rules` JSONB (the same
 * objects `src/lib/leagues/scoring/templates.ts` authors and migration 058
 * seeds), never a hand-maintained display table that could drift from the
 * seeded rows. The colocated test golden-pins each derivation against the
 * templates.ts literals (tasks-M1 §4.3 UI scoping).
 *
 * The two things here that are NOT derived from rules are spec-table
 * metadata that exists only in §7.3.3's printed table (not in the DB row):
 *   - the per-template ONE-LINERS ("ESPN's defaults, 0 PPR" …), verbatim;
 *   - the "(platform default)" markers (Yahoo Half PPR, Sleeper Full PPR).
 * Both are keyed by the row's `name` (058's stable natural key, partial
 * UNIQUE) and pinned as stored literals in the test. A row with an unknown
 * name (impossible under the 058 seed, but never invent data) degrades
 * gracefully: derived PPR one-liner, no marker, sorted after the known six.
 */

/** The template row shape the picker consumes (world-readable SELECT over
 *  `scoring_systems` WHERE `is_template` — 058's anon-capable policy). */
export interface ScoringTemplateRow {
  id: string
  name: string
  description: string | null
  rules: Record<string, number>
}

/** Kicking tier values (App B.4 keys). `null` = the key is ABSENT from the
 *  template's rules (Yahoo's defaults omit miss penalties — omitted, not 0),
 *  rendered as "—" so absence never masquerades as a zero coefficient. */
export interface KickingSummary {
  fg0_39: number | null
  fg40_49: number | null
  fg50Plus: number | null
  patMade: number | null
  fgMissed: number | null
  patMissed: number | null
}

/** The compare view's key category values (task text: PPR, INT, kicking,
 *  D/ST model) — all derived from `rules`. */
export interface TemplateSummary {
  /** `receptions` coefficient (0 / 0.5 / 1 across the v1 six). */
  ppr: number
  /** `interceptions` coefficient (ESPN −2 vs Yahoo/Sleeper −1, App B.1). */
  int: number
  kicking: KickingSummary
  /** `split` = the rules carry the ESPN `def_ya_*` yards-allowed family
   *  alongside `def_pa_*` (dst_model split, App B.4/D44); `single` = points-
   *  allowed only (Yahoo/Sleeper). Derived from key presence — the DB row
   *  stores no dst_model field. */
  dstModel: 'split' | 'single'
}

/** One rendered card. Exactly one card per fetched row — the picker invents
 *  nothing (no teaser/placeholder slots; spec v2.7 + §16.5.5). */
export interface TemplateCard {
  /** `scoring_systems.id` — what selection emits (`scoring_system_id`). */
  id: string
  name: string
  /** §7.3.3 table one-liner (verbatim), or the derived fallback. */
  oneLiner: string
  /** Full row `description`, untruncated — the ESPN rows carry the Q9
   *  parity-exception line (v2.8.5) and it must stay commissioner-visible. */
  description: string
  /** §7.3.3 "(platform default)" marker. */
  isPlatformDefault: boolean
  summary: TemplateSummary
}

/** §7.3.3 table order — also the picker's card order (and templates.ts's
 *  SCORING_TEMPLATES order). */
export const TEMPLATE_DISPLAY_ORDER: readonly string[] = [
  'ESPN Standard',
  'ESPN Full PPR',
  'Yahoo Standard',
  'Yahoo Half PPR',
  'Sleeper Standard',
  'Sleeper Full PPR',
]

/** §7.3.3 table one-liners, verbatim. */
export const TEMPLATE_ONE_LINERS: Readonly<Record<string, string>> = {
  'ESPN Standard': "ESPN's defaults, 0 PPR",
  'ESPN Full PPR': "ESPN's defaults, 1.0 PPR",
  'Yahoo Standard': "Yahoo's defaults, 0 PPR (note: −1 INT)",
  'Yahoo Half PPR': "Yahoo's defaults, 0.5 PPR",
  'Sleeper Standard': "Sleeper's defaults, 0 PPR",
  'Sleeper Full PPR': "Sleeper's defaults, 1.0 PPR",
}

/** §7.3.3 "(platform default)" rows. */
export const PLATFORM_DEFAULT_TEMPLATE_NAMES: readonly string[] = [
  'Yahoo Half PPR',
  'Sleeper Full PPR',
]

const num = (rules: Record<string, number>, key: string): number | null =>
  typeof rules[key] === 'number' ? rules[key] : null

/** Derive the compare view's key category values from a rules object. */
export function deriveTemplateSummary(
  rules: Record<string, number>,
): TemplateSummary {
  return {
    ppr: num(rules, 'receptions') ?? 0,
    int: num(rules, 'interceptions') ?? 0,
    kicking: {
      fg0_39: num(rules, 'fg_0_39'),
      fg40_49: num(rules, 'fg_40_49'),
      fg50Plus: num(rules, 'fg_50_plus'),
      patMade: num(rules, 'pat_made'),
      fgMissed: num(rules, 'fg_missed'),
      patMissed: num(rules, 'pat_missed'),
    },
    dstModel: Object.keys(rules).some((k) => k.startsWith('def_ya_'))
      ? 'split'
      : 'single',
  }
}

/**
 * Rows → cards: §7.3.3 order (unknown names after, stable by name), one
 * card per row, id preserved for selection emission. Input order never
 * matters (the DB query doesn't promise one).
 */
export function buildTemplateCards(
  rows: readonly ScoringTemplateRow[],
): TemplateCard[] {
  const orderOf = (name: string) => {
    const i = TEMPLATE_DISPLAY_ORDER.indexOf(name)
    return i === -1 ? TEMPLATE_DISPLAY_ORDER.length : i
  }
  return [...rows]
    .sort(
      (a, b) =>
        orderOf(a.name) - orderOf(b.name) || a.name.localeCompare(b.name),
    )
    .map((row) => {
      const summary = deriveTemplateSummary(row.rules)
      return {
        id: row.id,
        name: row.name,
        oneLiner:
          TEMPLATE_ONE_LINERS[row.name] ?? `${formatPoints(summary.ppr)} PPR`,
        description: row.description ?? '',
        isPlatformDefault: PLATFORM_DEFAULT_TEMPLATE_NAMES.includes(row.name),
        summary,
      }
    })
}

/** Display formatting: real minus sign (−2), plain positives (0.5), "—" for
 *  an absent key — absence is not zero (Yahoo omits miss penalties). */
export function formatPoints(value: number | null): string {
  if (value === null) return '—'
  return String(value).replace('-', '−')
}
