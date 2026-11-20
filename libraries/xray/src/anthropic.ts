import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"

import { type CallModel, UnansweredError } from "./generate.ts"
import { segmentOutputSchema } from "./registry.ts"

export const DEFAULT_XRAY_MODEL = "claude-haiku-5-5"

const MAX_OUTPUT_TOKENS = 16000

/** How many times one passage is asked before the run gives up on it. */
const MAX_ATTEMPTS = 3

export interface AnthropicModelOptions {
  apiKey: string
  model?: string
}

/** A `CallModel` that asks a Claude model through the Anthropic API. */
export function createAnthropicModel(
  options: AnthropicModelOptions,
): CallModel {
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 4 })
  const model = options.model ?? DEFAULT_XRAY_MODEL

  return async ({ system, user }) => {
    let inputTokens = 0
    let outputTokens = 0
    let stopReason: string | null = null

    // An answer cut off at the token limit, or declined, is often complete
    // when asked again, so one bad draw should not cost the passage.
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(segmentOutputSchema) },
      })
      inputTokens += response.usage.input_tokens
      outputTokens += response.usage.output_tokens
      stopReason = response.stop_reason

      const text = response.content.find((block) => block.type === "text")
      if (stopReason === "end_turn" && text) {
        return { output: JSON.parse(text.text), inputTokens, outputTokens }
      }
    }

    throw new UnansweredError(
      `the model did not finish its answer in ${MAX_ATTEMPTS} attempts (${stopReason ?? "unknown"})`,
      inputTokens,
      outputTokens,
    )
  }
}
