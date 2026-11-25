/**
 * Single letters in a row are one word: "H.M.S." and "H M S" become "hms",
 * "J. R. R." and "J.R.R." become "jrr".
 */
export function mergeInitials(words: string): string {
  const out: string[] = []
  let run = ""
  for (const word of words.split(" ")) {
    if (word.length === 1 && /\p{L}/u.test(word)) {
      run += word
      continue
    }
    if (run) out.push(run)
    run = ""
    if (word) out.push(word)
  }
  if (run) out.push(run)
  return out.join(" ")
}

function foldText(text: string): string {
  return mergeInitials(
    text
      .normalize("NFKD")
      .toLowerCase()
      .replace(/\p{M}/gu, "")
      .replace(/[’'ʼ]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim(),
  )
}

export function normalizeText(text: string): string {
  return foldText(text).replace(/^(?:the|an|a)(?: |$)/, "")
}

export function titleWithoutSubtitle(title: string): string {
  const end = title.search(/[:;(]/)
  return (end > 0 ? title.slice(0, end) : title).trim()
}

export function mainTitle(title: string): string {
  return normalizeText(titleWithoutSubtitle(title))
}

export function canonicalAuthor(name: string): string {
  const parts = name.split(",").map((part) => part.trim())
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`.trim()
  return name.trim()
}

export function authorKey(name: string): string {
  return foldText(canonicalAuthor(name))
}

export function workIdentity(title: string, authors: string[]): string {
  return `${mainTitle(title)}|${authorKey(authors[0] ?? "")}`
}

type WorkName = { title: string; authors: string[] }

export function sameWork(a: WorkName, b: WorkName): boolean {
  const title = mainTitle(a.title)
  if (!title || title !== mainTitle(b.title)) return false

  const authors = new Set(a.authors.map(authorKey).filter(Boolean))
  return b.authors.some((author) => authors.has(authorKey(author)))
}

type SeriesRefLike = { key: string; name: string; position: number | null }

/**
 * One name for a series however a catalog qualifies it:
 * "Horatio Hornblower (chronological order)" and "Horatio Hornblower
 * (publication order) (abridged)" are the same family.
 */
export function seriesFamily(name: string): string {
  return normalizeText(name.replace(/\([^)]*\)/g, " "))
}

/**
 * The series a work is best read in when the catalog lists several: the
 * one the reader named, else the most specific (lowest position, so a
 * trilogy's book 1 wins over the same book as #4 of its wider universe),
 * never an abridged-edition listing when another exists.
 */
export function primarySeries<T extends SeriesRefLike>(
  refs: T[],
  preferName?: string | null,
): T | null {
  if (!refs.length) return null
  if (preferName) {
    const family = seriesFamily(preferName)
    const named = refs.find((ref) => seriesFamily(ref.name) === family)
    if (named) return named
  }
  const full = refs.filter((ref) => !/abridged/i.test(ref.name))
  const pool = full.length ? full : refs
  return (
    [...pool].sort(
      (a, b) =>
        (a.position ?? Number.POSITIVE_INFINITY) -
        (b.position ?? Number.POSITIVE_INFINITY),
    )[0] ?? null
  )
}
