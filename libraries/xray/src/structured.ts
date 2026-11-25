import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { type z } from "zod"

/** Token use of one call, including prompt-cache writes and reads. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
}

export interface StructuredCallOptions<T extends z.ZodType> {
  apiKey: string
  model: string
  system: string
  user: string
  schema: T
  maxTokens?: number
  /** Override for tests. */
  client?: Pick<Anthropic, "messages">
}

export class StructuredCallError extends Error {
  constructor(
    message: string,
    readonly usage: TokenUsage,
  ) {
    super(message)
    this.name = "StructuredCallError"
  }
}

const MAX_ATTEMPTS = 2

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  }
}

export function addUsage(into: TokenUsage, more: TokenUsage): TokenUsage {
  into.inputTokens += more.inputTokens
  into.outputTokens += more.outputTokens
  into.cacheWriteTokens += more.cacheWriteTokens
  into.cacheReadTokens += more.cacheReadTokens
  return into
}

/**
 * Ask a Claude model for an answer that fits `schema`. The answer is
 * validated; a cut-off or unparseable answer is asked once more.
 */
export async function callStructured<T extends z.ZodType>(
  options: StructuredCallOptions<T>,
): Promise<{ output: z.output<T>; usage: TokenUsage }> {
  const client =
    options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 3 })
  const usage = emptyUsage()
  // No prompt caching: the output schema is part of the prefix, so calls
  // with different schemas never share a cache entry.
  const content: Anthropic.TextBlockParam[] = [
    { type: "text", text: options.user },
  ]

  let problem = "no answer"
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 8000,
      system: options.system,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(options.schema) },
    })
    addUsage(usage, {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    })
    const text = response.content.find((block) => block.type === "text")
    if (response.stop_reason !== "end_turn" || !text) {
      problem = `the model stopped early (${response.stop_reason ?? "unknown"})`
      continue
    }
    try {
      const parsed = options.schema.safeParse(JSON.parse(text.text))
      if (parsed.success) return { output: parsed.data, usage }
      problem = "the answer did not fit the expected shape"
    } catch {
      problem = "the answer was not JSON"
    }
  }
  throw new StructuredCallError(problem, usage)
}

/** US dollars per million tokens. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-fable-5-2": { input: 8, output: 40 },
}

/**
 * The cost of `usage` in millionths of a dollar. Cache writes cost 1.25×
 * input, cache reads 0.1×. Unknown models are priced like the dearest one,
 * so a budget never undercounts.
 */
export function costMicroUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model] ?? { input: 8, output: 40 }
  const dollars =
    (usage.inputTokens * price.input +
      usage.cacheWriteTokens * price.input * 1.25 +
      usage.cacheReadTokens * price.input * 0.1 +
      usage.outputTokens * price.output) /
    1_000_000
  return Math.round(dollars * 1_000_000)
}
