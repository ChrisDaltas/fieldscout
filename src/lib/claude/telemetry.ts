import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Token/latency/cost logging for every Claude call (plan §3.4), written to
 * ai_call_log with the service role. Doubles as the accounting source for
 * per-user daily rate limits. Server-only — never import from the client.
 */

export type AiFeature =
  | 'list_generation'
  | 'persona_seed'
  | 'persona_refresh'
  | 'content_ingest'
  | 'content_generate'
  | 'ask_ai'

export interface AiCallLogEntry {
  /** Null for system jobs (seeds, crons). */
  user_id?: string | null
  feature: AiFeature
  model: string
  input_tokens?: number | null
  output_tokens?: number | null
  latency_ms?: number | null
  success: boolean
  error?: string | null
}

/** Best-effort: a telemetry failure must never fail the underlying AI call. */
export async function logAiCall(entry: AiCallLogEntry): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('ai_call_log').insert({
      user_id: entry.user_id ?? null,
      feature: entry.feature,
      model: entry.model,
      input_tokens: entry.input_tokens ?? null,
      output_tokens: entry.output_tokens ?? null,
      latency_ms: entry.latency_ms ?? null,
      success: entry.success,
      error: entry.error ?? null,
    })
    if (error) console.error('[ai_call_log] insert failed:', error.message)
  } catch (err) {
    console.error('[ai_call_log] insert failed:', err)
  }
}

/**
 * Calls a user has made against a feature since the start of the current UTC
 * day. Counts attempts (success or failure) so a failing loop can't hammer
 * the API for free.
 */
export async function countAiCallsToday(
  userId: string,
  feature: AiFeature,
): Promise<number> {
  const admin = createAdminClient()
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)

  const { count, error } = await admin
    .from('ai_call_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('feature', feature)
    .gte('created_at', dayStart.toISOString())

  if (error) {
    // Fail open on telemetry errors: blocking Pro users on a logging outage
    // is worse than briefly uncapped usage (the monthly ceiling still holds).
    console.error('[ai_call_log] count failed:', error.message)
    return 0
  }
  return count ?? 0
}
