import { getSettings } from "@/database/settings"

export type AiConfig = {
  apiKey: string
  /** Ranks candidates and writes reasons. */
  model: string
  /** Parses text, matches imports. */
  fastModel: string
  monthlyBudgetUsd: number
}

/**
 * The Anthropic key and models recommendations use, or null when no key is
 * set: recommendations and Ask are then off. The key is the one X-Ray uses.
 */
export async function getAiConfig(): Promise<AiConfig | null> {
  const settings = await getSettings()
  const apiKey = settings.xrayAnthropicApiKey?.trim()
  if (!apiKey) return null
  return {
    apiKey,
    model: settings.recommendationModel,
    fastModel: settings.recommendationFastModel,
    monthlyBudgetUsd: settings.recommendationMonthlyBudgetUsd,
  }
}
