import { CLAUDE_GENERATION_MODEL } from '@/lib/claude/models'
import { renderStyleDescription } from '@/lib/claude/styles'
import { structuredClaudeCall } from '@/lib/claude/structured'
import { assertNoRealAnalystNames } from '@/lib/personas/blocklist'
import type { PersonaStyleProfile } from '@/lib/personas/roster'
import {
  generatedListSchema,
  type AiPosition,
  type AiScoringFormat,
  type GeneratedList,
} from '@/types/schemas/ai'

/**
 * Ranked-list generation prompts (spec-ai-list-generation.md template) and the
 * persona wrapper used by seeding/refresh jobs. Invariant for persona lists:
 * ranks may mirror a published source exactly, the words are ALWAYS ours —
 * enforced here by the parody-firewall blocklist on every generation.
 */

export interface SourceRankEntry {
  rank: number
  player_name: string
  team?: string | null
}

export interface GenerationPromptArgs {
  position: AiPosition
  scoring: AiScoringFormat
  /** Style label shown to the model (e.g. 'Consensus' or a persona name). */
  style: string
  styleDescription: string
  playerCount: number
  packetRendered: string
  /** When present, the model mirrors these ranks exactly (persona source path). */
  sourceRanks?: SourceRankEntry[]
}

export function buildGenerationPrompt({
  position,
  scoring,
  style,
  styleDescription,
  playerCount,
  packetRendered,
  sourceRanks,
}: GenerationPromptArgs): string {
  const mirrorBlock = sourceRanks?.length
    ? `\nPublished source ranks to mirror EXACTLY (same players, same order, for every player present in the data packet):\n${sourceRanks
        .map((r) => `${r.rank}. ${r.player_name}${r.team ? ` (${r.team})` : ''}`)
        .join('\n')}\nYour rationale text must be entirely original — never quote or paraphrase the source.\n`
    : ''

  return `You are a fantasy football ranking assistant for FieldScout. Generate a ranked list of the top ${playerCount} ${position} players for ${scoring} scoring.

Ranking style: ${style}
${styleDescription}
${mirrorBlock}
Here is the current player data for all active ${position} players:
${packetRendered}

Instructions:
1. Return exactly ${playerCount} players, ranked 1 through ${playerCount}
2. For each player, write one concise sentence (max 20 words) explaining their placement
3. Stay true to the ranking style — the rationale should reflect that bias clearly
4. Do not include injured players on IR
5. Only rank players that appear in the data packet above — never invent players
6. Return valid JSON matching the required output schema

At the end of the list, include a one-sentence "style_note" explaining what this ranking style prioritized.`
}

export interface PersonaListArgs {
  personaName: string
  styleProfile: PersonaStyleProfile
  position: AiPosition
  scoring: AiScoringFormat
  playerCount: number
  packetRendered: string
  sourceRanks?: SourceRankEntry[]
}

export interface PersonaListResult {
  list: GeneratedList
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

export async function generatePersonaList({
  personaName,
  styleProfile,
  position,
  scoring,
  playerCount,
  packetRendered,
  sourceRanks,
}: PersonaListArgs): Promise<PersonaListResult> {
  const prompt = buildGenerationPrompt({
    position,
    scoring,
    style: personaName,
    styleDescription: renderStyleDescription(styleProfile),
    playerCount,
    packetRendered,
    sourceRanks,
  })

  const { data, inputTokens, outputTokens, latencyMs } =
    await structuredClaudeCall({
      model: CLAUDE_GENERATION_MODEL,
      schema: generatedListSchema,
      prompt,
    })

  // Parody firewall: generated prose must never contain a real analyst's name.
  assertNoRealAnalystNames(
    JSON.stringify(data),
    `generated list for ${personaName}`,
  )

  return { list: data, inputTokens, outputTokens, latencyMs }
}
