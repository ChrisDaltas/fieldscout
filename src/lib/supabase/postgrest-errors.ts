/**
 * postgrest-errors — how to tell "the database has no such object yet" from
 * every other error (the deploy-before-push rule: merged code reaches
 * fieldscout.gg before Chris pushes its migration, so a new door or table can
 * be ABSENT for a while). Shared by the trade screens (162, D426) and the
 * stats poll's ingest door (167, D432) — moved here from `trades-service.ts`
 * (R1316, the L.E2.1 review), behaviour unchanged.
 */

/** The fields both a PostgREST error and a supabase-js RPC error carry. */
export interface PostgrestErrorLike {
  code?: string | null
  message: string
  hint?: string | null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when `error` is the database saying one of `names` does not EXIST —
 * PostgREST's schema-cache answers (PGRST205 "Could not find the table
 * 'public.x'", PGRST202 "Could not find the function public.x(…)" — both
 * measured on the local stack 2026-09-28) or Postgres's own (42P01 relation /
 * 42883 function). Anchored on the object's NAME so an unrelated missing
 * object is never mistaken for "not deployed" (R1222's lesson: anchor the
 * match).
 */
export function isMissingSchemaObject(error: PostgrestErrorLike | null | undefined, names: readonly string[]): boolean {
  if (!error) return false
  if (!['PGRST205', 'PGRST202', '42P01', '42883'].includes(error.code ?? '')) return false
  const message = error.message ?? ''
  return names.some((name) => new RegExp(`(\\bpublic\\.${escapeRegExp(name)}\\b|"${escapeRegExp(name)}")`).test(message))
}

/**
 * R1282: true ONLY when the database has no such door — its migration not
 * pushed yet — never for a call the door exists for but does not match
 * (argument drift). PostgREST answers both with PGRST202 (measured on the
 * local stack 2026-09-29), so a PGRST202 counts as "not pushed" only when
 * (a) its hint does not offer the SAME function under another signature
 * ("Perhaps you meant to call the function public.trade_deadline(p_league_id)"
 * — the door is there) and (b) every argument it names is one of the door's
 * own (a `p_bogus` means the CALL drifted — the hint is not always given,
 * measured: `trade_preview(p_bogus, p_league_id)` came back with `hint:
 * null`). `doors` maps each door's name to the parameters the caller sends.
 * Anything else is a loud failure, never the quiet fallback.
 */
export function isDoorNotPushed(
  error: PostgrestErrorLike | null | undefined,
  doors: Readonly<Record<string, readonly string[]>>,
): boolean {
  if (!error) return false
  for (const [name, params] of Object.entries(doors)) {
    if (!isMissingSchemaObject(error, [name])) continue
    if (error.code !== 'PGRST202') return true
    if ((error.hint ?? '').includes(`public.${name}(`)) return false
    const args = new RegExp(`public\\.${escapeRegExp(name)}\\(([^)]*)\\)`).exec(error.message ?? '')
    const named = (args?.[1] ?? '').split(',').map((a) => a.trim()).filter(Boolean)
    return named.every((a) => params.includes(a))
  }
  return false
}
