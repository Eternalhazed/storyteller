import { authorKey } from "@/catalog/normalize"

import { SERIES_LENGTHS, type SeriesLength, type SeriesShape } from "./types"

/** Main books in a series → its length bucket; null for a standalone. */
export function lengthBucket(books: number | null): SeriesLength | null {
  if (books == null || books <= 1) return null
  if (books <= 4) return "short"
  if (books <= 9) return "medium"
  return "long"
}

/** Starting penalties; the backtest tunes them. */
export const PENALTIES = { adjacent: 10, far: 25, shape: 15, format: 20 }

export type ShapeInput = {
  /** Main books in the candidate's series; null for a standalone. */
  seriesBooks: number | null
  /** Whether the work has an audiobook edition. */
  hasAudio: boolean
}

export type ShapePrefs = {
  seriesShape: SeriesShape
  seriesLength: readonly SeriesLength[]
  /** The reader wants to listen (alone or along with the ebook). */
  needsAudio: boolean
}

/**
 * The score to subtract for crossing the reader's series and format
 * preferences, and the label that says so on the card. A crossed pick is
 * never dropped here; it only ranks lower.
 */
export function preferencePenalty(
  input: ShapeInput,
  prefs: ShapePrefs,
): { penalty: number; label: string | null } {
  const bucket = lengthBucket(input.seriesBooks)
  let penalty = 0
  const labels: string[] = []

  if (bucket === null && prefs.seriesShape === "series") {
    penalty += PENALTIES.shape
    labels.push("Standalone")
  } else if (bucket !== null && prefs.seriesShape === "standalone") {
    penalty += PENALTIES.shape
    labels.push(`Part of a series: ${input.seriesBooks} books`)
  }

  if (
    bucket !== null &&
    prefs.seriesShape !== "standalone" &&
    prefs.seriesLength.length &&
    !prefs.seriesLength.includes(bucket)
  ) {
    const rank = SERIES_LENGTHS.indexOf(bucket)
    let nearest = Infinity
    let shorter = false
    let longer = false
    for (const preferred of prefs.seriesLength) {
      const difference = rank - SERIES_LENGTHS.indexOf(preferred)
      nearest = Math.min(nearest, Math.abs(difference))
      shorter ||= difference < 0
      longer ||= difference > 0
    }
    penalty += nearest === 1 ? PENALTIES.adjacent : PENALTIES.far
    const label =
      shorter && longer
        ? "Between preferred lengths"
        : shorter
          ? "Shorter"
          : "Longer"
    labels.push(`${label}: ${input.seriesBooks} books`)
  }

  if (prefs.needsAudio && !input.hasAudio) {
    penalty += PENALTIES.format
    labels.push("Ebook only")
  }

  return { penalty, label: labels.length ? labels.join(" · ") : null }
}

export type Rankable = {
  identity: string
  authors: string[]
  seriesKey: string | null
  stretch: boolean
  score: number
}

/**
 * Best first, then at most two picks per author, one per series and one
 * stretch across the whole round. `taken` carries the counts over from
 * picks already placed.
 */
export function applyDiversity<T extends Rankable>(
  items: T[],
  limit: number,
  taken: DiversityState = newDiversityState(),
): T[] {
  const out: T[] = []
  for (const item of [...items].sort((a, b) => b.score - a.score)) {
    if (out.length >= limit) break
    if (taken.identities.has(item.identity)) continue
    const author = item.authors[0] ? authorKey(item.authors[0]) : null
    if (author && (taken.authors.get(author) ?? 0) >= 2) continue
    if (item.seriesKey && taken.series.has(item.seriesKey)) continue
    if (item.stretch && taken.stretch) continue
    out.push(item)
    taken.identities.add(item.identity)
    if (author) taken.authors.set(author, (taken.authors.get(author) ?? 0) + 1)
    if (item.seriesKey) taken.series.add(item.seriesKey)
    if (item.stretch) taken.stretch = true
  }
  return out
}

export type DiversityState = {
  identities: Set<string>
  authors: Map<string, number>
  series: Set<string>
  stretch: boolean
}

export function newDiversityState(): DiversityState {
  return {
    identities: new Set(),
    authors: new Map(),
    series: new Set(),
    stretch: false,
  }
}
