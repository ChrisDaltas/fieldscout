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
 * The things here that are NOT derived from rules are spec metadata that
 * exists only in the spec's own text (not in the DB row):
 *   - the six parity-template ONE-LINERS ("ESPN's defaults, 0 PPR" …),
 *     verbatim from §7.3.3's printed table;
 *   - Scout Standard's card copy, TRIMMED from Appendix B.5's Chris-approved
 *     "why it's better" copy (SC.3/D282 — §16.2 says the card carries B.5's
 *     copy; the fuller approved sentences ride the seeded row description
 *     directly beneath it on the same card), and Scout PPR's one-liner,
 *     the §7.3.3 table row's copy APPROVED as drafted 2026-09-01 (B.5.1);
 *   - the "(platform default)" markers (Yahoo Half PPR, Sleeper Full PPR)
 *     and the "FieldScout's default" marker on the ACTIVE family's Scout
 *     (B.5's own subtitle; §7.3.3's system-default bullet — per family
 *     since v2.16.11, see `DEFAULT_TEMPLATE_NAMES` below).
 * All are keyed by the row's `name` (the 058/106/108 seeds' stable natural
 * key, partial UNIQUE) and pinned as stored literals in the test. A row with
 * an unknown name (impossible under the seeds, but never invent data)
 * degrades gracefully: derived PPR one-liner, no marker, sorted after the
 * known eight.
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
  /** `receptions` coefficient (0 / 0.2 / 0.5 / 1 across the shipped eight
   *  — Scout PPR's 0.2 joined at SC.4). */
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
  /**
   * The §7.3.3 possessive marker copy ("Yahoo's platform default" / "Sleeper's
   * platform default") for the platform-default rows, else null (R73 — the
   * spec table prints the possessive, not a generic "Platform default").
   */
  platformDefaultMarker: string | null
  /**
   * SC.3/SC.4 (§7.3.3's system-default bullet, v2.16.11): "FieldScout's
   * default" on the ACTIVE family's Scout card — the same possessive-marker
   * pattern as the platform rows (R73), copy from App B.5's own subtitle —
   * else null. Unfiltered mounts mark the system default (Scout Standard)
   * alone; a style-filtered view marks its family's own Scout (B.5.1's
   * marker law — `buildTemplateCards`' `family` argument). The card is what
   * reads as the recommended default; the PRESELECTION itself is the
   * mounts' business (`resolveDefaultTemplateId` below).
   */
  defaultMarker: string | null
  summary: TemplateSummary
}

/** §7.3.3 table order — also the picker's card order (and templates.ts's
 *  SCORING_TEMPLATES order). v2.16.11: the Scout pair leads (the amended
 *  table's order IS the picker order — its system-default bullet), so each
 *  style-filtered view leads with its own Scout and the unfiltered launcher
 *  leads with the pair. */
export const TEMPLATE_DISPLAY_ORDER: readonly string[] = [
  'Scout Standard',
  'Scout PPR',
  'ESPN Standard',
  'ESPN Full PPR',
  'Yahoo Standard',
  'Yahoo Half PPR',
  'Sleeper Standard',
  'Sleeper Full PPR',
]

/**
 * Card one-liners. The six parity rows are §7.3.3's table one-liners,
 * verbatim. Scout Standard's is App B.5's Chris-approved "why it's better"
 * copy, TRIMMED to card length — every phrase taken from the approved text,
 * no claim changed (SC.3/D282; supersedes the §7.3.3-row-verbatim entry
 * whose "Appendix B.5" citation tail read oddly on a product card —
 * D279(8)). The approved copy's remaining sentences — "instead of a pile of
 * inherited quirks", the per-yard rates, the D/ST model — ride the seeded
 * row DESCRIPTION rendered directly beneath this line on the same card.
 * Scout PPR's is its §7.3.3 table row's one-liner, APPROVED as drafted by
 * Chris 2026-09-01 (App B.5.1) — its fuller approved copy is the seeded row
 * description, same pattern.
 */
export const TEMPLATE_ONE_LINERS: Readonly<Record<string, string>> = {
  'Scout Standard':
    'One clean rule set — every TD is 6, every FG is 3, no PPR. Yardage ' +
    'at flat, memorable rates.',
  'Scout PPR':
    "The catch counts — volume alone still can't outscore production.",
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

// ---------------------------------------------------------------------------
// SC.3/SC.4 — the §7.3.3 system default, per reception-style family since
// v2.16.11 (spec §7.3.3's amended system-default bullet; App B.5.1)
// ---------------------------------------------------------------------------

/** The wizard's reception-style filter families (§16.2's style step). */
export type ScoringStyleFamily = 'ppr' | 'no_ppr'

/**
 * The default template NATURAL KEYS, one per style family (v2.16.11's
 * preselection law: each family preselects its own Scout — the No-PPR view
 * Scout Standard, the PPR view Scout PPR). Resolution is always by these
 * names under `is_template` (058/108's partial UNIQUE) against the fetched
 * template rows — never a hardcoded uuid, because `gen_random_uuid()` makes
 * the row's id differ per environment.
 */
export const DEFAULT_TEMPLATE_NAMES: Readonly<
  Record<ScoringStyleFamily, string>
> = {
  no_ppr: 'Scout Standard',
  ppr: 'Scout PPR',
}

/**
 * The SYSTEM default's natural key — Scout Standard (no-PPR is the
 * FieldScout identity of the original 2026-08-26 ruling; RULED again at the
 * 2026-09-01 markup: "Scout Standard should be the default selected
 * template."). Unfiltered mounts (the mock launcher) preselect THIS one;
 * style-filtered views preselect their family's entry above.
 */
export const DEFAULT_TEMPLATE_NAME = DEFAULT_TEMPLATE_NAMES.no_ppr

/**
 * The Scout cards' marker copy — B.5's own subtitle ("FieldScout's
 * default"), in the platform rows' possessive-marker pattern (R73). Worn by
 * the system default (Scout Standard) on unfiltered mounts and by the
 * family's own Scout in a style-filtered view — a badge on a filtered-out
 * card marks nothing (B.5.1's marker law).
 */
export const DEFAULT_TEMPLATE_MARKER = "FieldScout's default"

/**
 * Resolve the §7.3.3 default's id from the fetched template rows by natural
 * key — the FAMILY dimension picks which half of the Scout pair (v2.16.11):
 * omitted/`'no_ppr'` resolves the system default Scout Standard (the
 * unfiltered mock launcher's call), `'ppr'` resolves Scout PPR (the
 * wizard's PPR view). Returns null — and says so LOUDLY, naming whichever
 * half is missing — when that family's Scout row is absent (an environment
 * whose seeds stop before migration 108, the Scout pair): the CLAUDE.md
 * "nothing happened" rule forbids a silent un-defaulting, so the
 * degradation is named in the console and the surfaces fall back to the
 * pre-SC.3 explicit-pick flow (nothing preselected; both submit gates keep
 * refusing a null until the user picks a card — a designed state, not a
 * blank one).
 */
export function resolveDefaultTemplateId(
  rows: readonly ScoringTemplateRow[] | undefined,
  family: ScoringStyleFamily = 'no_ppr',
): string | null {
  if (rows === undefined) return null // still loading — nothing to resolve yet
  const name = DEFAULT_TEMPLATE_NAMES[family]
  const row = rows.find((r) => r.name === name)
  if (row === undefined) {
    console.warn(
      `[scoring-templates] The "${name}" template row is missing from the ` +
        'fetched templates (has this environment run migration 108, the ' +
        'Scout pair?). No template will be preselected — the user must ' +
        'pick one explicitly (§7.3.3 system-default bullet, SC.3/SC.4).',
    )
    return null
  }
  return row.id
}

/**
 * The ONE preselection rule, shared by the two league-less mounts (the
 * create wizard and the MP.4 mock launcher — the settings mount renders the
 * league's STORED reference and never defaults over it): an explicit pick
 * always wins; the resolved system default fills only an empty pick — a
 * preselection, never an override and never a silent write (`create_league`
 * still receives the explicit id the submit builder emits); null when
 * neither exists, which the submit gates refuse exactly as before SC.3.
 */
export function effectiveTemplateSelection(
  explicitId: string | null,
  defaultId: string | null,
): string | null {
  return explicitId ?? defaultId
}

/**
 * §7.3.3 possessive marker copy for the platform-default rows (R73 — the spec
 * table prints "(Yahoo's platform default)" / "(Sleeper's platform default)",
 * not a generic "Platform default"). Keyed by the row's stable `name`.
 */
export const PLATFORM_DEFAULT_MARKERS: Readonly<Record<string, string>> = {
  'Yahoo Half PPR': "Yahoo's platform default",
  'Sleeper Full PPR': "Sleeper's platform default",
}

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
 *
 * `family` (SC.4 — B.5.1's marker law): which Scout card wears the
 * "FieldScout's default" marker. Omitted = an unfiltered mount = the system
 * default, Scout Standard, alone; a style-filtered view passes its family
 * so the marker moves to that family's own Scout — a badge on a
 * filtered-out card marks nothing.
 */
export function buildTemplateCards(
  rows: readonly ScoringTemplateRow[],
  family?: ScoringStyleFamily,
): TemplateCard[] {
  const orderOf = (name: string) => {
    const i = TEMPLATE_DISPLAY_ORDER.indexOf(name)
    return i === -1 ? TEMPLATE_DISPLAY_ORDER.length : i
  }
  const defaultName = DEFAULT_TEMPLATE_NAMES[family ?? 'no_ppr']
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
        platformDefaultMarker: PLATFORM_DEFAULT_MARKERS[row.name] ?? null,
        defaultMarker:
          row.name === defaultName ? DEFAULT_TEMPLATE_MARKER : null,
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

// ---------------------------------------------------------------------------
// SE.9 — the "Customize" entry's league context (spec §7.3.3.1 entry-point
// bullet; D170)
// ---------------------------------------------------------------------------

/**
 * League context for the ONE mount that has a league — the settings panel.
 * D170: the Customize affordance lives in league context only. The create
 * wizard has no league yet (a league is born on a template; `create_league`'s
 * template-only check is untouched) and the standalone mock launcher has no
 * league at all (`drafts.league_id` is nullable — migration 095), so BOTH of
 * those mounts omit this prop and render templates-only, unchanged.
 */
export interface ScoringCustomizeContext {
  /** The viewer's role in the league (league detail `my_role`). */
  myRole: string | null
  /** `leagues.status` — Customize renders in `setup`/`scheduled` only. */
  leagueStatus: string
  /** Fires SE.6's fork mutation with the clicked card's template id. */
  onCustomize: (templateId: string) => void
  /** Template id with a fork in flight — all Customize buttons disable,
   *  the in-flight card shows the pending label. */
  pendingTemplateId?: string | null
  /** When set, Customize renders disabled and this reason renders above the
   *  grid (e.g. the settings form holds unsaved non-scoring edits — a fork
   *  re-seeds the form, and silently discarding typed values would be the
   *  CLAUDE.md "nothing happened" failure shape). */
  disabledReason?: string | null
}

/**
 * Is the Customize affordance visible? Commissioner-only, league in
 * `setup`/`scheduled` (the §7.3 header window; §7.3.3.1's access bullet —
 * the RPC enforces, the UI states it), and only where a league context
 * exists at all (D170).
 *
 * Deliberately mirrors `scoringEditorAccess(...).canEdit`
 * (scoring-editor-ops.ts) WITHOUT importing it: the editor ops module runs
 * an import-time catalog guard and pulls the scoring engine, none of which
 * the two league-less picker mounts (wizard, mock launcher) should pay for.
 * The mirror is pinned, not trusted: the colocated render test asserts this
 * predicate agrees with `scoringEditorAccess` across the full role × status
 * matrix.
 */
export function canCustomize(
  context: Pick<ScoringCustomizeContext, 'myRole' | 'leagueStatus'> | undefined,
): boolean {
  if (!context) return false
  const isCommissioner =
    context.myRole === 'commissioner' || context.myRole === 'co_commissioner'
  const inEditWindow =
    context.leagueStatus === 'setup' || context.leagueStatus === 'scheduled'
  return isCommissioner && inEditWindow
}
