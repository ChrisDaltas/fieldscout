import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/auth/require-user'
import { isClaudeConfigured } from '@/lib/claude/client'
import { aiListGenerationDailyLimit } from '@/lib/claude/limits'
import { CLAUDE_GENERATION_MODEL } from '@/lib/claude/models'
import {
  buildGenerationPrompt,
  type SourceRankEntry,
} from '@/lib/claude/persona-gen'
import {
  buildPlayerPacket,
  resolveGeneratedPlayers,
} from '@/lib/claude/player-packet'
import {
  AI_GENERATION_FEATURE,
  claimAiGeneration,
  rateLimitMessage,
  readAiGenerationQuota,
  releaseAiGeneration,
} from '@/lib/claude/quota'
import { structuredClaudeCall } from '@/lib/claude/structured'
import {
  renderStyleDescription,
  renderWeightedStyleDescription,
  styleByKey,
} from '@/lib/claude/styles'
import { logAiCall } from '@/lib/claude/telemetry'
import { assertNoRealAnalystNames } from '@/lib/personas/blocklist'
import {
  getPersonaContext,
  renderContextForPrompt,
} from '@/lib/personas/context'
import type { PersonaStyleProfile } from '@/lib/personas/roster'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  generateListRequestSchema,
  generatedListSchema,
  type GenerateListResponse,
  type StyleWeight,
} from '@/types/schemas/ai'

/**
 * POST /api/lists/generate — "Generate with AI" (spec-ai-list-generation.md).
 * Structured-output, server-side ID resolution, per-user daily rate limit.
 * Deliberately does NOT persist anything: the user saves explicitly via the
 * existing POST /api/lists + /api/lists/[id]/players flow.
 *
 * OPEN TO EVERY SIGNED-IN USER. The old requireProUser gate is gone: Pro is
 * suspended and the 2026 launch is free-only (CLAUDE.md). What replaces it is
 * a per-user daily cap — cost control on the Anthropic bill, applied equally
 * to every account, with no upgrade path attached to it.
 *
 * GET returns the caller's remaining allowance so the modal can show it.
 */

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const quota = await readAiGenerationQuota(gate.user.id)
  return NextResponse.json({
    limit: quota.limit,
    used: quota.used,
    remaining: quota.remaining,
    resets_at: quota.resetsAt,
  })
}

export async function POST(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response
  const { user, supabase } = gate

  if (!isClaudeConfigured()) {
    return NextResponse.json(
      { error: 'AI generation is not configured on this server.', code: 'AI_NOT_CONFIGURED' },
      { status: 503 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = generateListRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { position, scoring, player_count } = parsed.data

  // Weighted ranking styles: dedupe by key (last entry wins).
  const weightByKey = new Map<StyleWeight['key'], StyleWeight>()
  for (const w of parsed.data.style_weights ?? []) weightByKey.set(w.key, w)
  const weights = [...weightByKey.values()]

  // Optional AI expert. Two .eq() lookups instead of .or(): the value is user
  // input and persona display names contain characters PostgREST's or-syntax
  // reserves.
  interface ResolvedPersona {
    id: string
    display_name: string
    style_profile: PersonaStyleProfile
  }
  let persona: ResolvedPersona | null = null
  if (parsed.data.persona) {
    const personaQuery = () =>
      supabase
        .from('ai_personas')
        .select('id, username, display_name, style_profile')
        .eq('is_active', true)
        .is('deleted_at', null)
    let { data: found } = await personaQuery()
      .eq('username', parsed.data.persona)
      .maybeSingle()
    if (!found) {
      const byDisplayName = await personaQuery()
        .eq('display_name', parsed.data.persona)
        .limit(1)
        .maybeSingle()
      found = byDisplayName.data
    }
    if (!found) {
      return NextResponse.json(
        { error: `Unknown AI expert: ${parsed.data.persona}` },
        { status: 400 },
      )
    }
    persona = {
      id: found.id as string,
      display_name: found.display_name as string,
      style_profile: found.style_profile as unknown as PersonaStyleProfile,
    }
  }

  // Assemble {style_description}: persona voice/stances and weighted
  // priorities are independent, composable, and both optional — neither
  // present degrades to a plain consensus board.
  const descriptionParts: string[] = []
  if (persona) descriptionParts.push(renderStyleDescription(persona.style_profile))
  if (weights.length > 0) descriptionParts.push(renderWeightedStyleDescription(weights))
  if (descriptionParts.length === 0) {
    descriptionParts.push(styleByKey('consensus').description)
  }
  const styleLabel =
    persona && weights.length > 0
      ? `${persona.display_name} Blend`
      : persona
        ? persona.display_name
        : weights.length > 0
          ? 'Custom Blend'
          : 'Consensus'

  // Personas are grounded in their living context (current sourced stances,
  // movements, themes) and mirror the analyst's latest scraped ranks when
  // available (spec-ai-content-engine.md §Use Case 1). Both tables are
  // service-role only; absent data degrades gracefully.
  let sourceRanks: SourceRankEntry[] | undefined
  if (persona) {
    const admin = createAdminClient()
    const [ranksRes, context] = await Promise.all([
      admin
        .from('persona_source_rankings')
        .select('raw_rankings')
        .eq('ai_persona_id', persona.id)
        .eq('position', position)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      getPersonaContext(admin, persona.id),
    ])
    const raw = ranksRes.data?.raw_rankings as SourceRankEntry[] | undefined
    if (Array.isArray(raw) && raw.length > 0) sourceRanks = raw
    if (context) descriptionParts.push(renderContextForPrompt(context))
  }
  const styleDescription = descriptionParts.join('\n\n')

  // Tracks whether a quota slot is currently held, so every failure path below
  // refunds exactly once and a path that never claimed refunds nothing.
  let claimed = false

  try {
    const packet = await buildPlayerPacket(supabase, {
      position,
      scoring,
      playerCount: player_count,
    })

    const prompt = buildGenerationPrompt({
      position,
      scoring,
      style: styleLabel,
      styleDescription,
      playerCount: player_count,
      packetRendered: packet.rendered,
      sourceRanks,
    })

    // ---- Quota: claimed as late as possible, but strictly BEFORE the spend --
    // Everything above this line is free (validation, our own DB reads), so a
    // bad request or an unknown persona never costs the user a generation.
    // The claim is an atomic check-and-increment in Postgres (migration 074),
    // so two rapid double-submits cannot both get through.
    const limit = aiListGenerationDailyLimit()
    const claim = await claimAiGeneration(user.id, AI_GENERATION_FEATURE, limit)

    if (!claim) {
      // Quota bookkeeping is unavailable — fail closed rather than let
      // uncapped spend through.
      return NextResponse.json(
        {
          error: 'AI generation is briefly unavailable. Please try again in a minute.',
          code: 'QUOTA_UNAVAILABLE',
        },
        { status: 503 },
      )
    }

    if (!claim.allowed) {
      return NextResponse.json(
        {
          error: rateLimitMessage(claim.limit),
          code: 'RATE_LIMITED',
          limit: claim.limit,
          used: claim.used,
          remaining: 0,
          resets_at: claim.resetsAt,
        },
        { status: 429 },
      )
    }
    claimed = true

    const { data, inputTokens, outputTokens, latencyMs } =
      await structuredClaudeCall({
        model: CLAUDE_GENERATION_MODEL,
        schema: generatedListSchema,
        prompt,
      })

    // Parody firewall applies to all generated prose, persona-styled or not.
    assertNoRealAnalystNames(JSON.stringify(data), 'generated list')

    await logAiCall({
      user_id: user.id,
      feature: AI_GENERATION_FEATURE,
      model: CLAUDE_GENERATION_MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
      success: true,
    })

    const resolvedAll = resolveGeneratedPlayers(data.players, packet.players)
    // Enforce "at most N players" server-side; a shortfall is reported via
    // `unresolved` so the client can surface it.
    const players = resolvedAll.players.slice(0, player_count)
    const unresolved = resolvedAll.unresolved
    if (players.length === 0) {
      // Nothing usable came back — the user got no list, so refund the slot.
      await releaseAiGeneration(user.id, AI_GENERATION_FEATURE)
      claimed = false
      return NextResponse.json(
        { error: 'Generation produced no resolvable players. Try again.' },
        { status: 500 },
      )
    }

    const response: GenerateListResponse = {
      position,
      scoring,
      style: styleLabel,
      player_count,
      players,
      style_note: data.style_note,
      unresolved,
    }
    return NextResponse.json(response)
  } catch (err) {
    // A failed generation must not burn quota (the whole reason the claim is
    // a reservation rather than a plain counter bump).
    if (claimed) await releaseAiGeneration(user.id, AI_GENERATION_FEATURE)

    const message = err instanceof Error ? err.message : String(err)
    await logAiCall({
      user_id: user.id,
      feature: AI_GENERATION_FEATURE,
      model: CLAUDE_GENERATION_MODEL,
      success: false,
      error: message,
    })
    console.error('[generate] failed:', message)
    return NextResponse.json(
      { error: 'AI generation failed. Please try again.' },
      { status: 500 },
    )
  }
}
