export const MAX_LOOKUP_QUERY_LENGTH = 500

export type SelectionLookupProvider = "wikipedia" | "google" | "wiktionary"

export type SelectionLookupUrlResult =
  | { ok: true; query: string; url: string }
  | { ok: false; reason: "empty" | "invalid" | "too-long" }

const lookupUrlPrefixes: Record<SelectionLookupProvider, string> = {
  wikipedia: "https://en.wikipedia.org/wiki/Special:Search?search=",
  google: "https://www.google.com/search?q=",
  wiktionary: "https://en.wiktionary.org/wiki/Special:Search?search=",
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
      query,
      url: `${lookupUrlPrefixes[provider]}${encodeURIComponent(query)}`,
    }
  } catch {
    return { ok: false, reason: "invalid" }
  }
}

export async function openSelectionLookup(
  provider: SelectionLookupProvider,
  getSelectedText: () => Promise<string | undefined>,
  {
    onOpen,
    openUrl,
    openWikipediaApp,
  }: {
    onOpen: () => void
    openUrl: (url: string) => Promise<unknown>
    openWikipediaApp: (query: string, url: string) => Promise<boolean>
  },
): Promise<SelectionLookupUrlResult> {
  const result = buildSelectionLookupUrl(provider, await getSelectedText())
  if (!result.ok) return result

  onOpen()
  if (
    provider === "wikipedia" &&
    (await openWikipediaApp(result.query, result.url))
  ) {
    return result
  }
  await openUrl(result.url)
  return result
}
