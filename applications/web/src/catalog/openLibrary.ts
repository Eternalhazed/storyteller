import { cacheTtl, cachedList, cachedMany } from "./cache"
import { requestCatalog } from "./limiter"
import type { Catalog, CatalogWork } from "./types"

const HEADERS = {
  "User-Agent": "Storyteller catalog (https://github.com/smoores/storyteller)",
}
const FIELDS =
  "key,title,subtitle,author_name,language,number_of_pages_median,subject,cover_i,isbn"
const BATCH = 25
const ISBN_LIMIT = 50

const languageTags: Record<string, string> = {
  ara: "ar",
  chi: "zh",
  zho: "zh",
  dan: "da",
  dut: "nl",
  nld: "nl",
  eng: "en",
  fin: "fi",
  fre: "fr",
  fra: "fr",
  ger: "de",
  deu: "de",
  gre: "el",
  ell: "el",
  heb: "he",
  hin: "hi",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  nor: "no",
  pol: "pl",
  por: "pt",
  rus: "ru",
  spa: "es",
  swe: "sv",
  tur: "tr",
  ukr: "uk",
}

type OpenLibraryDoc = {
  key: string
  title?: string
  subtitle?: string
  author_name?: string[]
  language?: string[]
  number_of_pages_median?: number
  subject?: string[]
  cover_i?: number
  isbn?: string[]
}

type OpenLibraryResults = { docs?: OpenLibraryDoc[]; numFound?: number }

async function openLibrary(params: Record<string, string>) {
  const url = new URL("https://openlibrary.org/search.json")
  url.search = new URLSearchParams({ fields: FIELDS, ...params }).toString()
  return requestCatalog<OpenLibraryResults>(url, HEADERS)
}

export function openLibraryId(key: string): string | null {
  return /^ol:(OL\d+W)$/.exec(key)?.[1] ?? null
}

function mapDoc(doc: OpenLibraryDoc, isbn?: string): CatalogWork | null {
  const olid = /^(?:\/works\/)?(OL\d+W)$/.exec(doc.key)?.[1]
  const title = doc.title?.trim()
  if (!olid || !title) return null
  const languages = doc.language ?? []
  const language = languages.includes("eng") ? "eng" : languages[0]
  const isbn13 =
    isbn?.length === 13
      ? isbn
      : doc.isbn?.find((value) => /^\d{13}$/.test(value))
  return {
    key: `ol:${olid}`,
    title,
    subtitle: doc.subtitle?.trim() || null,
    authors: (doc.author_name ?? []).filter(Boolean),
    narrators: [],
    series: [],
    releaseDate: null, // Search returns a publication year, not a release date.
    language: language
      ? (languageTags[language] ??
        (/^[a-z]{2,3}$/.test(language) ? language : null))
      : null,
    runtimeMinutes: null,
    pages: doc.number_of_pages_median ?? null,
    abridged: null,
    subjects: [...new Set((doc.subject ?? []).filter(Boolean))].slice(0, 10),
    description: null,
    coverUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : null,
    ids: { olid, ...(isbn13 && { isbn13 }) },
  }
}

export const searchOpenLibrary: Catalog["search"] = async ({
  title,
  author,
  limit = 10,
}) => {
  if (!title || limit < 1) return []
  return cachedList(
    JSON.stringify([title, author ?? null, limit]),
    "ol:search:",
    cacheTtl.search,
    async () => {
      const response = await openLibrary({
        title,
        ...(author && { author }),
        limit: String(limit),
      })
      return (response?.docs ?? [])
        .flatMap((doc) => {
          const work = mapDoc(doc)
          return work ? [work] : []
        })
        .slice(0, limit)
    },
  )
}

export async function getOpenLibraryWorks(
  ids: string[],
): Promise<Map<string, CatalogWork>> {
  const works = await cachedMany(
    ids,
    "ol:work:",
    cacheTtl.work,
    async (missing) => {
      const found = new Map<string, CatalogWork>()
      for (let offset = 0; offset < missing.length; offset += BATCH) {
        const batch = missing.slice(offset, offset + BATCH)
        const response = await openLibrary({
          q: `key:(${batch.map((id) => `"/works/${id}"`).join(" OR ")})`,
          limit: String(batch.length),
        })
        for (const doc of response?.docs ?? []) {
          const work = mapDoc(doc)
          const id = work?.ids["olid"]
          if (work && id) found.set(id, work)
        }
      }
      return found
    },
  )
  return new Map([...works.values()].map((work) => [work.key, work]))
}

async function searchIsbns(isbns: string[], found: Map<string, CatalogWork>) {
  const response = await openLibrary({
    q: isbns.map((isbn) => `isbn:${isbn}`).join(" OR "),
    limit: String(ISBN_LIMIT),
  })
  const pending = new Set(isbns)
  const docs = response?.docs ?? []
  for (const doc of docs) {
    for (const value of doc.isbn ?? []) {
      const isbn = value.toUpperCase()
      if (!pending.has(isbn)) continue
      const work = mapDoc(doc, isbn)
      if (!work) continue
      found.set(isbn, work)
      pending.delete(isbn)
    }
    if (!pending.size) return
  }
  // An ISBN can appear in several work records. If the union overflowed the
  // result page, retry only the ISBNs that did not appear in it.
  if (isbns.length > 1 && (response?.numFound ?? 0) > docs.length) {
    for (const isbn of pending) await searchIsbns([isbn], found)
  }
}

export const findOpenLibraryByIsbn: Catalog["findByIsbn"] = async (isbns) => {
  const requested = new Map<string, string>()
  for (const raw of isbns) {
    const isbn = raw.replace(/[\s-]/g, "").toUpperCase()
    if (/^(?:\d{13}|\d{9}[\dX])$/.test(isbn)) requested.set(raw, isbn)
  }
  const works = await cachedMany(
    [...requested.values()],
    "ol:isbn:",
    cacheTtl.work,
    async (missing) => {
      const found = new Map<string, CatalogWork>()
      for (let offset = 0; offset < missing.length; offset += BATCH) {
        await searchIsbns(missing.slice(offset, offset + BATCH), found)
      }
      return found
    },
  )
  const result = new Map<string, CatalogWork>()
  for (const [raw, isbn] of requested) {
    const work = works.get(isbn)
    if (work) result.set(raw, work)
  }
  return result
}
