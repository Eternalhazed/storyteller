import { withHasPermission } from "@/auth/auth"
import { getSetting } from "@/database/settings"

export const dynamic = "force-dynamic"

/** Returns only whether generation is configured, never the provider key. */
export const GET = withHasPermission("bookProcess")(async () => {
  const apiKey = await getSetting("xrayAnthropicApiKey")
  return Response.json({ configured: !!apiKey?.trim() })
})
