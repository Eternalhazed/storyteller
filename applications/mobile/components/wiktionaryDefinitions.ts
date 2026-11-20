import { normalizeSelectionLookupText } from "./selectionLookup"

export const MAX_DEFINITION_TERM_WORDS = 5

const DEFINITION_ENDPOINT =
  "https://en.wiktionary.org/api/rest_v1/page/definition/"
// Wikimedia rejects generic HTTP-client user agents (Android's default
// "okhttp/x" gets a 403), so identify the app as its UA policy requires.
const USER_AGENT =
  "Storyteller-mobile (https://gitlab.com/storyteller-platform/storyteller)"

export type DefinitionEntry = {
  language: string
  partOfSpeech: string
  definitions: string[]
  /** The lemma when every definition is an inflection ("plural of whale"). */
  formOf: string | null
}

export type DefinitionLookup =
  | {
      status: "found"
      term: string
      entries: DefinitionEntry[]
      /** Set when the selected word was an inflection of `term`. */
      inflection: { form: string; description: string } | null
    }
  | { status: "not-found"; term: string }

export type DefinitionTermResult =
  | { ok: true; term: string }
  | { ok: false; reason: "empty" | "too-many-words" }

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal | null },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
}

/**
 * Turns a reader selection into a dictionary headword: collapses whitespace,
 * uses straight apostrophes (Wiktionary's title convention), and drops the
 * quotes and punctuation that cling to words in running text.
 */
export function getDefinitionTerm(
  selectedText: string | null | undefined,
): DefinitionTermResult {
  const term = normalizeSelectionLookupText(selectedText)
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(EDGE_PUNCTUATION, "")
    .trim()

  if (!term) return { ok: false, reason: "empty" }
  if (term.split(" ").length > MAX_DEFINITION_TERM_WORDS) {
    return { ok: false, reason: "too-many-words" }
  }
  return { ok: true, term }
}

/**
 * Wiktionary titles are case-sensitive, and running text capitalizes
 * sentence-initial words and adds possessives, so fall back to the
 * lowercase and non-possessive forms when the exact form has no entry.
 */
export function getDefinitionCandidates(term: string): string[] {
  const withoutPossessive = term.replace(/'s$/u, "")
  return [
    ...new Set([
      term,
      term.toLowerCase(),
      withoutPossessive,
      withoutPossessive.toLowerCase(),
    ]),
  ].filter(Boolean)
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/gu, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, code: string) => {
      if (!code.startsWith("#")) {
        return NAMED_ENTITIES[code.toLowerCase()] ?? entity
      }
      const codePoint =
        code.startsWith("#x") || code.startsWith("#X")
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10)
      return codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity
    })
    .replace(/\s+/gu, " ")
    .trim()
}

// The REST payload is third-party data: every field is checked before use.
type RawUsage =
  | { language?: unknown; partOfSpeech?: unknown; definitions?: unknown }
  | null
  | undefined
type RawDefinition = { definition?: unknown } | null | undefined

// Wiktionary marks inflection senses with this span, linking to the lemma.
const FORM_OF_LEMMA = /class="form-of-definition-link"[\s\S]*?title="([^"]+)"/u

function parseUsages(usages: unknown): DefinitionEntry[] {
  if (!Array.isArray(usages)) return []

  return (usages as RawUsage[]).flatMap((usage) => {
    const partOfSpeech = usage?.partOfSpeech
    const definitions = usage?.definitions
    if (typeof partOfSpeech !== "string" || !Array.isArray(definitions)) {
      return []
    }

    const senses = (definitions as RawDefinition[])
      .map((definition) => definition?.definition)
      .filter((html) => typeof html === "string")
      .map((html) => {
        const lemma = FORM_OF_LEMMA.exec(html)?.[1]
        return {
          text: htmlToPlainText(html),
          lemma: lemma ? htmlToPlainText(lemma) : null,
        }
      })
      .filter((sense) => sense.text)
    if (senses.length === 0) return []

    const language = usage?.language
    return [
      {
        language: typeof language === "string" ? language : "",
        partOfSpeech,
        definitions: senses.map((sense) => sense.text),
        formOf: senses.every((sense) => sense.lemma)
          ? senses[0]?.lemma ?? null
          : null,
      },
    ]
  })
}

/**
 * Reads the REST definition payload, which groups usages by language code:
 * the English usages, plus the first other language that has any (so
 * loanwords and foreign phrases can still get a definition).
 */
export function parseDefinitionResponse(body: unknown): {
  english: DefinitionEntry[]
  other: DefinitionEntry[]
} {
  if (typeof body !== "object" || body === null) {
    return { english: [], other: [] }
  }

  const { en, ...otherLanguages } = body as Record<string, unknown>
  return {
    english: parseUsages(en),
    other:
      Object.values(otherLanguages)
        .map(parseUsages)
        .find((entries) => entries.length > 0) ?? [],
  }
}

/**
 * English wins across every candidate: a capitalized sentence-initial word
 * ("Some") can be a foreign-only title while its lowercase form is English.
 * When the English entry only names an inflection ("plural of whale"), the
 * lemma's own definitions are shown instead, with the inflection noted.
 */
export async function lookupDefinition(
  term: string,
  {
    fetch: fetchImpl = fetch,
    signal,
  }: { fetch?: FetchLike; signal?: AbortSignal | undefined } = {},
): Promise<DefinitionLookup> {
  const request = async (title: string) => {
    const response = await fetchImpl(
      `${DEFINITION_ENDPOINT}${encodeURIComponent(title)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: signal ?? null,
      },
    )
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Definition request failed with HTTP ${response.status}`)
    }
    return parseDefinitionResponse(await response.json())
  }

  let foreignMatch: DefinitionLookup | undefined

  for (const candidate of getDefinitionCandidates(term)) {
    const parsed = await request(candidate)
    if (!parsed) continue

    const { english, other } = parsed
    if (english.length > 0) {
      const lemma = english.every((entry) => entry.formOf)
        ? english[0]?.formOf
        : null
      const lemmaEntries =
        lemma && lemma !== candidate ? (await request(lemma))?.english : null
      // "harpooned" is a verb form, so the verb senses of "harpoon" lead.
      const inflectedPartsOfSpeech = english.map((entry) => entry.partOfSpeech)
      const matchesInflection = (entry: DefinitionEntry) =>
        inflectedPartsOfSpeech.includes(entry.partOfSpeech)

      return lemma && lemmaEntries?.length
        ? {
            status: "found",
            term: lemma,
            entries: [
              ...lemmaEntries.filter(matchesInflection),
              ...lemmaEntries.filter((entry) => !matchesInflection(entry)),
            ],
            inflection: {
              form: candidate,
              description: english[0]?.definitions[0] ?? "",
            },
          }
        : {
            status: "found",
            term: candidate,
            entries: english,
            inflection: null,
          }
    }
    if (!foreignMatch && other.length > 0) {
      foreignMatch = {
        status: "found",
        term: candidate,
        entries: other,
        inflection: null,
      }
    }
  }

  return foreignMatch ?? { status: "not-found", term }
}
