export const MAX_LOOKUP_QUERY_LENGTH = 500

export type SelectionLookupProvider = "wikipedia" | "google"

export type SelectionLookupUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "invalid" | "too-long" }

const lookupUrlPrefixes: Record<SelectionLookupProvider, string> = {
  wikipedia: "https://en.wikipedia.org/wiki/Special:Search?search=",
  google: "https://www.google.com/search?q=",
}

export function normalizeSelectionLookupText(
  selectedText: string | null | undefined,
): string {
  return (selectedText ?? "").normalize("NFC").replace(/\s+/gu, " ").trim()
}

export function buildSelectionLookupUrl(
  provider: SelectionLookupProvider,
  selectedText: string | null | undefined,
): SelectionLookupUrlResult {
  const query = normalizeSelectionLookupText(selectedText)
  if (!query) return { ok: false, reason: "empty" }
  if (Array.from(query).length > MAX_LOOKUP_QUERY_LENGTH) {
    return { ok: false, reason: "too-long" }
  }

  try {
    return {
      ok: true,
      url: `${lookupUrlPrefixes[provider]}${encodeURIComponent(query)}`,
    }
  } catch {
    return { ok: false, reason: "invalid" }
  }
}
