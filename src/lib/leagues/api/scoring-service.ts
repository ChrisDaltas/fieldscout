/**
 * League custom-scoring service — SE.6 (spec §7.3.3.1 entry point + lifecycle;
 * §12.25 "Writes are server-authoritative"; §15.1 via this task's erratum).
 *
 * Two verbs, both fronting migration 105's SECURITY DEFINER RPCs:
 *
 *   POST /api/leagues/[id]/scoring/fork   → `scoring_fork_template`
 *   PUT  /api/leagues/[id]/scoring/rules  → `scoring_update_rules`
 *
 * The Route Handlers above these are thin wrappers (auth + param plumbing —
 * CLAUDE.md: *"app/ → Routes and layouts only. Minimal logic"*); everything
 * testable lives here and takes an INJECTED Supabase client, so
 * `scoring-api-db.test.ts` drives the exact composition the routes run over the
 * real PostgREST wire path with real signed-in clients (the D68 convention).
 *
 * **This layer owns NO rule.** §7.3.3.1(5) is explicit that client Zod is UX
 * only and the server write path is the wall; SE.5's RPCs carry the
 * commissioner check, the `setup`/`scheduled` window, the template predicate,
 * the fork-row predicate and `scoring_rules_validate`, and migration 104's
 * three walls stand behind them. What this file adds is TRANSLATION: a
 * PostgREST error becomes the status + `fieldErrors` shape the settings panel
 * already branches on (`LeaguePatchError`, `src/hooks/use-league.ts`), and the
 * RPCs' P0001 sentences surface VERBATIM because they were written to be read
 * by a commissioner (§7.3.3.1's E75 posture: a refusal names its own reason).
 *
 * **Q28 is OPEN and this file deliberately does not improvise around it.**
 * A structurally empty document (`{}`) passes `validateScoringRulesDoc`, the
 * Zod schema, `scoring_rules_validate` and wall 1 — so it passes here too. The
 * question of whether "the document must be able to score something" is a
 * guardrail family, and where that clause would live (PROGRESS §3 Q28 answers:
 * **not** in the save RPC — the same downgrade is reachable by direct table
 * write), is Chris's to rule. This route builds to the validator as it exists.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database, Json } from '@/types/database'

import { SCORING_GUARDRAILS, scoringRulesDocSchema } from '../scoring/validate-rules-doc'
import type { ServiceResult } from './leagues-service'

type Supabase = SupabaseClient<Database>

// ---------------------------------------------------------------------------
// 1. Wire contracts
// ---------------------------------------------------------------------------

/**
 * POST …/scoring/fork — `{ template_id }`.
 *
 * Strict: an unknown key is a 400 rather than a silent strip (the R77 lesson
 * — a plain `z.object` would drop `templateId` and fork whatever the league
 * already pointed at, which is the "nothing happened means it worked" shape).
 * The template PREDICATE (`is_template = TRUE AND owner_id IS NULL`) is the
 * RPC's, not this schema's: `z.uuid()` is a shape fence.
 */
export const forkScoringTemplateInputSchema = z.strictObject({
  template_id: z.uuid(),
})

/**
 * PUT …/scoring/rules — `{ rules }`.
 *
 * `rules` is REQUIRED and is parsed by SE.3's `scoringRulesDocSchema`, which
 * is itself a DELEGATION to `validateScoringRulesDoc` rather than a third
 * hand-written mirror of the guardrails (its own docblock says why). Note the
 * shape of the required-ness: `z.unknown()` is an OPTIONAL key in Zod's
 * inference, so a body with no `rules` at all arrives at the refinement as
 * `undefined` — where the validator's `document_shape` family rejects it.
 * That path is pinned (`scoring-service.test.ts` §A) precisely because it
 * reads like an accident waiting to happen.
 */
export const updateScoringRulesInputSchema = z.strictObject({
  rules: scoringRulesDocSchema,
})

// ---------------------------------------------------------------------------
// 2. RPC error → HTTP
// ---------------------------------------------------------------------------

/**
 * A Zod refusal in the SAME `{ formErrors, fieldErrors }` shape
 * `LeaguePatchError` already reads — but keyed by the **full dot path**
 * rather than `z.flattenError`'s first path segment.
 *
 * The reason is specific to this contract: a scoring violation's path is
 * `rules.base.receptions` / `rules.positions.QB.fg_0_39`, and
 * `z.flattenError` would collapse every one of them to the single key
 * `rules` — so the editor could show *that* something is wrong and never
 * *which input*. The dot path is also exactly what the RPC branch below
 * produces from 103's DETAIL, so the two enforcement layers answer in ONE
 * shape. (For the fork verb, whose only field is top-level `template_id`,
 * this is byte-identical to `z.flattenError`.)
 */
function flattenIssues(error: z.ZodError): Json {
  const formErrors: string[] = []
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    if (issue.path.length === 0) {
      formErrors.push(issue.message)
      continue
    }
    const path = issue.path.map((segment) => String(segment)).join('.')
    ;(fieldErrors[path] ??= []).push(issue.message)
  }
  return { formErrors, fieldErrors }
}

/** What PostgREST hands back for a raised exception (supabase-js's
 *  `PostgrestError`): SQLSTATE plus 103's MESSAGE / DETAIL / HINT triple. */
interface RpcError {
  code?: string | null
  message: string
  details?: string | null
  hint?: string | null
}

/** 103 raises the guardrail family in `HINT`. Runtime membership, so an
 *  unrecognised hint can never be mistaken for a document rejection. */
const GUARDRAIL_HINTS: ReadonlySet<string> = new Set<string>(SCORING_GUARDRAILS)

/**
 * The P0001 refusals that describe the LEAGUE'S STATE rather than the caller's
 * input — a 409, the treatment `mapPatchRpcError` already gives the §7.3 status
 * gate. Nothing here is a field the client can correct in place: the fix is
 * forking first, or accepting that the draft has started.
 *
 * The markers are DISJOINT by construction (no 105 message contains two of
 * them), so first-match is order-independent; every one has an exact-message
 * pin in `scoring-api-db.test.ts`, which is what keeps that true.
 */
const STATE_CONFLICT_MARKERS: readonly string[] = [
  // Both RPCs' §7.3 window refusal ("…can only be customized/edited while…").
  'scoring can only be',
  // The league is still on a shared template — fork before saving.
  'fork first, templates are immutable',
  // The league references nothing yet.
  'fork a template first',
  // Something other than this league's own fork sits in front of the league.
  "is not this league's own forked custom row",
]

/**
 * P0001 refusals that ARE about the caller's input, keyed to the field that
 * carries it. Fork only: the save verb's single input is the document, and a
 * bad document arrives with a guardrail HINT instead (below).
 */
const FORK_FIELD_MARKERS: readonly string[] = [
  'p_template_id must reference one of the scoring templates',
  'already carries a "format" member',
]

/**
 * Map a 105 refusal onto the `LeaguePatchError` shape.
 *
 * `docField` is where THIS verb's document lives in the request body, because
 * a guardrail violation's DETAIL is a dot path INSIDE the document
 * (`base.def_points_allowed`, `positions.QB.fg_0_39`, or the literal
 * `(document)`): the save verb keys it under `rules.<path>` so the editor can
 * light the offending input, while the fork verb keys it under `template_id` —
 * the fork document is BUILT IN SQL from the template, so if it fails
 * validation the caller's only input is which template they picked.
 *
 * **Exported for its branch pins, and one branch is deliberately unreachable
 * through the route — said out loud rather than left to look like coverage.**
 * The guardrail-HINT arm can only fire if the RPC's `scoring_rules_validate`
 * rejects a document the TS validator accepted, and the save route parses
 * `rules` through that same TS validator first (`scoringRulesDocSchema`
 * delegates to it) — so while the TS≡SQL mirrors agree (measured by
 * `scoring-parity-db.test.ts`), the Zod layer answers first and this arm never
 * runs. It exists so that a mirror DRIFT surfaces as a keyed field error
 * instead of a bare 400, which is precisely the case no live fixture can
 * construct; `scoring-service.test.ts` drives it directly instead. The other
 * arms ARE live-reachable and are pinned over the stack, each on a sentence
 * only 105 can produce, so those assertions name the layer that answered.
 */
export function mapScoringRpcError(
  error: RpcError,
  docField: 'rules' | 'template_id',
): ServiceResult {
  const code = error.code ?? ''

  if (code === '42501') {
    return {
      status: 403,
      body: { error: 'Only the commissioner can change this league’s scoring.' },
    }
  }
  if (code === 'P0002') {
    return { status: 404, body: { error: 'League not found' } }
  }

  if (code === 'P0001') {
    const hint = error.hint ?? ''
    if (GUARDRAIL_HINTS.has(hint)) {
      // **103's DETAIL is INJECTIVE and this must not flatten it (F138 / R602).**
      // The literal `(document)` means the document; an EMPTY detail means the
      // empty key `''` — a legal JSON key that is simply not scorable. SQL was
      // given that distinction deliberately at SE.4 (the four document-level
      // sites raise a NULL path and COALESCE to `(document)`), and TS cannot
      // make it, so collapsing the two here would discard the only place it
      // exists. An empty key therefore keys to `rules.` — a trailing empty
      // segment, exactly as a format-2 document's own path (`base.`) spells it.
      const detail = error.details
      const path =
        docField === 'template_id' || detail == null || detail === '(document)'
          ? docField
          : `${docField}.${detail}`
      return { status: 400, body: { error: { fieldErrors: { [path]: [error.message] } } } }
    }
    if (STATE_CONFLICT_MARKERS.some((marker) => error.message.includes(marker))) {
      return { status: 409, body: { error: error.message } }
    }
    if (
      docField === 'template_id' &&
      FORK_FIELD_MARKERS.some((marker) => error.message.includes(marker))
    ) {
      return { status: 400, body: { error: { fieldErrors: { template_id: [error.message] } } } }
    }
    return { status: 400, body: { error: error.message } }
  }

  // 103's tier-cut argument checks raise 22023; a DB CHECK backstop raises
  // 23514. Client errors, not server faults (the `mapPatchRpcError` posture).
  if (code === '22023' || code === '23514') {
    return { status: 400, body: { error: error.message } }
  }

  return { status: 500, body: { error: error.message } }
}

// ---------------------------------------------------------------------------
// 3. The two verbs
// ---------------------------------------------------------------------------

/**
 * POST …/scoring/fork — fork the picked template into the league's own
 * custom scoring row and repoint the league at it, in one transaction
 * (§7.3.3.1 entry point; `scoring_fork_template`, migration 105).
 *
 * Returns `{ scoring_system_id }` — the new row's id, or the SAME id on a
 * retry, because the RPC is idempotent by natural key (its banner: an existing
 * commissioner-owned non-template row whose `rules` deep-equal the document
 * this call would build is returned without inserting).
 */
export async function forkScoringTemplate(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = forkScoringTemplateInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: flattenIssues(parsed.error) } }
  }

  const { data, error } = await supabase.rpc('scoring_fork_template', {
    p_league_id: leagueId,
    p_template_id: parsed.data.template_id,
  })
  if (error) return mapScoringRpcError(error, 'template_id')

  return { status: 200, body: { scoring_system_id: data as string } }
}

/**
 * PUT …/scoring/rules — save the league's custom scoring document
 * (`scoring_update_rules`, migration 105).
 *
 * **The document is written VERBATIM.** The RPC refuses an un-normalized
 * document rather than normalizing it (guardrail 4 — its own banner explains
 * that a server which silently rewrites what it was sent would move the
 * derived All-Positions switch state with no error), so normalization stays
 * the client's save-time duty through `normalizeScoringDoc` — SE.7's. Nothing
 * here rewrites a rules document, and nothing here computes one: the only
 * transformation between the wire body and the RPC argument is Zod's
 * pass-through `.transform((value) => value as ScoringRulesDoc)`.
 */
export async function updateScoringRules(
  supabase: Supabase,
  leagueId: string,
  rawBody: unknown,
): Promise<ServiceResult> {
  const parsed = updateScoringRulesInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return { status: 400, body: { error: flattenIssues(parsed.error) } }
  }

  const { data, error } = await supabase.rpc('scoring_update_rules', {
    p_league_id: leagueId,
    p_rules: parsed.data.rules as unknown as Json,
  })
  if (error) return mapScoringRpcError(error, 'rules')

  return { status: 200, body: { scoring_system_id: data as string } }
}
