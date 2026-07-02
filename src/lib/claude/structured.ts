import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'

import { getClaudeClient } from '@/lib/claude/client'
import type { ClaudeModel } from '@/lib/claude/models'

/**
 * Structured-output helper: every AI feature returns JSON the app parses, so
 * calls are grammar-constrained to a Zod schema via the SDK's native
 * structured outputs (`messages.parse` + `zodOutputFormat`) and then
 * re-validated server-side before the result touches the DB or UI.
 */

export interface StructuredCallArgs<Schema extends z.ZodType> {
  model: ClaudeModel
  schema: Schema
  prompt: string
  system?: string
  maxTokens?: number
}

export interface StructuredCallResult<T> {
  data: T
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

export async function structuredClaudeCall<Schema extends z.ZodType>({
  model,
  schema,
  prompt,
  system,
  // Generous default: on Sonnet 5 adaptive thinking is on by default and its
  // tokens share this budget — a tight cap truncates large JSON outputs.
  maxTokens = 16000,
}: StructuredCallArgs<Schema>): Promise<StructuredCallResult<z.infer<Schema>>> {
  const client = getClaudeClient()
  const started = Date.now()

  const response = await client.messages.parse({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(schema) },
  })

  if (!response.parsed_output) {
    throw new Error(
      `Claude returned no parseable output (stop_reason: ${response.stop_reason}).`,
    )
  }

  // Belt-and-suspenders: validate again before anything downstream trusts it.
  const data = schema.parse(response.parsed_output)

  return {
    data,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs: Date.now() - started,
  }
}
