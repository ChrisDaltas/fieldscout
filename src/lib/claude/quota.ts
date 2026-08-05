import { z } from 'zod'

import { createAdminClient } from '@/lib/supabase/admin'

import { aiListGenerationDailyLimit } from './limits'
import type { AiFeature } from './telemetry'

/**
 * Per-user daily quota for AI features (migration 074).
 *
 * COST CONTROL for the Anthropic bill on the free-only 2026 launch — not an
 * upsell, not a Pro teaser. Every signed-in user gets the same allowance.
 *
 * Server-only: every function here goes through the service-role client and
 * the two SECURITY DEFINER routines from 074, which are revoked from anon and
 * authenticated. Never import this from a client component.
 *
 * The RESERVE-THEN-REFUND contract:
 *   1. `claimAiGeneration` atomically checks-and-increments before the Claude
 *      call. Two rapid double-submits can never both pass — the check and the
 *      increment are one statement inside the DB.
 *   2. If the work fails, `releaseAiGeneration` refunds the slot, so an
 *      errored generation costs the user nothing.
 *
 * The pure helpers (day keys, reset copy) live here too and import nothing —
 * they are unit-testable without a database.
 */

const MS_PER_MINUTE = 60_000

/** The feature key this module's quota applies to. */
export const AI_GENERATION_FEATURE: AiFeature = 'list_generation'

export interface QuotaClaim {
  /** True when a slot was taken and the caller may spend money. */
  allowed: boolean
  /** Generations spent today, after this claim. */
  used: number
  /** The cap this claim was measured against. */
  limit: number
  /** Generations left today (never negative). */
  remaining: number
  /** ISO timestamp of the next UTC day boundary. */
  resetsAt: string
}

export type QuotaStatus = Omit<QuotaClaim, 'allowed'>

// ---------------------------------------------------------------------------
// Pure helpers — no DB, no env
// ---------------------------------------------------------------------------

/** Start of the next UTC calendar day: the moment the allowance resets. */
export function nextUtcReset(now: Date = new Date()): Date {
  const next = new Date(now.getTime())
  next.setUTCHours(24, 0, 0, 0)
  return next
}

/**
 * Human phrasing for the time left until reset. Deliberately fuzzy ("about 5
 * hours") — the exact instant is in `resets_at` for anything that needs it.
 */
export function formatResetDistance(now: Date = new Date()): string {
  const minutes = Math.ceil((nextUtcReset(now).getTime() - now.getTime()) / MS_PER_MINUTE)
  if (minutes <= 1) return 'in under a minute'
  if (minutes < 60) return `in about ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  if (hours <= 1) return 'in about an hour'
  return `in about ${hours} hours`
}

/**
 * The 429 body copy. Names the real reset boundary — midnight UTC — instead of
 * saying "tomorrow" or "midnight", either of which would quietly imply the
 * user's local clock and be wrong for most of the world.
 */
export function rateLimitMessage(limit: number, now: Date = new Date()): string {
  if (limit < 1) {
    return 'AI list generation is switched off right now. Everything else on your lists still works.'
  }
  const noun = limit === 1 ? 'generation' : 'generations'
  return (
    `That's all ${limit} AI ${noun} for today — a daily cap that keeps FieldScout's ` +
    `AI costs sustainable while the app is free. You get ${limit} more when the day ` +
    `rolls over at midnight UTC, ${formatResetDistance(now)}.`
  )
}

// ---------------------------------------------------------------------------
// DB-backed operations
// ---------------------------------------------------------------------------

/** Shape of one `claim_ai_generation` row (RETURNS TABLE => array of rows). */
const claimRowSchema = z.object({
  is_allowed: z.boolean(),
  used_today: z.number().int(),
  daily_limit: z.number().int(),
})

/**
 * Atomically take one generation slot for `userId`, or refuse.
 *
 * FAILS CLOSED. If the RPC errors (missing migration, DB outage) we refuse the
 * call rather than let uncapped spend through — the whole point of this module
 * is that the bill cannot run away unattended. Callers surface it as a 503.
 */
export async function claimAiGeneration(
  userId: string,
  feature: AiFeature = AI_GENERATION_FEATURE,
  limit: number = aiListGenerationDailyLimit(),
  now: Date = new Date(),
): Promise<QuotaClaim | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('claim_ai_generation', {
    p_user_id: userId,
    p_feature: feature,
    p_limit: limit,
  })

  if (error) {
    console.error('[ai-quota] claim failed:', error.message)
    return null
  }

  const parsed = z.array(claimRowSchema).safeParse(data)
  if (!parsed.success || parsed.data.length === 0) {
    console.error('[ai-quota] claim returned an unexpected shape:', parsed.error?.message)
    return null
  }

  const row = parsed.data[0]
  return {
    allowed: row.is_allowed,
    used: row.used_today,
    limit: row.daily_limit,
    remaining: Math.max(row.daily_limit - row.used_today, 0),
    resetsAt: nextUtcReset(now).toISOString(),
  }
}

/**
 * Refund a slot claimed by `claimAiGeneration` when the work it guarded
 * failed. Best-effort by design: a refund failure must not turn a 500 into a
 * crash, and the counter self-corrects at the next UTC rollover regardless.
 */
export async function releaseAiGeneration(
  userId: string,
  feature: AiFeature = AI_GENERATION_FEATURE,
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.rpc('release_ai_generation', {
      p_user_id: userId,
      p_feature: feature,
    })
    if (error) console.error('[ai-quota] release failed:', error.message)
  } catch (err) {
    console.error('[ai-quota] release failed:', err)
  }
}

/**
 * Read-only quota for the UI ("2 of 3 left today"). Never writes, so polling
 * it is free. An unreadable counter reports a full allowance — the POST path
 * is the real gate, and a read blip should not make the modal look broken.
 */
export async function readAiGenerationQuota(
  userId: string,
  feature: AiFeature = AI_GENERATION_FEATURE,
  limit: number = aiListGenerationDailyLimit(),
  now: Date = new Date(),
): Promise<QuotaStatus> {
  const resetsAt = nextUtcReset(now).toISOString()
  const usageDate = now.toISOString().slice(0, 10)

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('ai_generation_usage')
      .select('used')
      .eq('user_id', userId)
      .eq('feature', feature)
      .eq('usage_date', usageDate)
      .maybeSingle()

    if (error) {
      console.error('[ai-quota] read failed:', error.message)
      return { used: 0, limit, remaining: limit, resetsAt }
    }

    const used = z.number().int().catch(0).parse(data?.used ?? 0)
    return { used, limit, remaining: Math.max(limit - used, 0), resetsAt }
  } catch (err) {
    console.error('[ai-quota] read failed:', err)
    return { used: 0, limit, remaining: limit, resetsAt }
  }
}
