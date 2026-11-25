// Kept free of server imports: the app reads these types too.

/** A series a work belongs to, as the catalog lists it. */
export type CatalogSeriesRef = {
  /** Stable id, e.g. `audible:B005NBOMVO`. */
  key: string
  name: string
  /** Whole or fractional position; null when the catalog gives none. */
  position: number | null
}

/** One book as a catalog knows it. */
export type CatalogWork = {
  /** Stable id: `audible:<ASIN>` or `ol:<work id>`. */
  key: string
  title: string
  subtitle: string | null
  authors: string[]
  narrators: string[]
  /** The primary series first. */
  series: CatalogSeriesRef[]
  /** `YYYY-MM-DD`. */
  releaseDate: string | null
  /** BCP 47 language tag, e.g. `en`. */
  language: string | null
  runtimeMinutes: number | null
  pages: number | null
  abridged: boolean | null
  /** Genres and subjects, most specific last, without duplicates. */
  subjects: string[]
  description: string | null
  coverUrl: string | null
  /** `asin`, `olid`, `isbn13` where known. */
  ids: Record<string, string>
}

/** A series and its main sequence in reading order. */
export type CatalogSeries = {
  key: string
  name: string
  authors: string[]
  /**
   * One work per whole-number position, in order. Novellas (fractional
   * positions), omnibuses (ranges) and other-language editions are left out.
   */
  books: { position: number; work: CatalogWork }[]
  /** The newest release in the main sequence, `YYYY-MM-DD`. */
  latestReleaseDate: string | null
}

/** How a history row or a typed title was tied to a catalog work. */
export type MatchedBy = "asin" | "isbn" | "title" | "model" | "reader"

export type ResolveQuery = {
  title: string
  authors?: string[]
  isbn13?: string | null
  isbn10?: string | null
  asin?: string | null
}

/**
 * Where the server looks books up. Implementations never invent a work:
 * everything returned came from a catalog response.
 */
export interface Catalog {
  /** Works matching a title, and an author when given, best first. */
  search(query: {
    title: string
    author?: string | null
    limit?: number
  }): Promise<CatalogWork[]>
  /** Works by key; unknown keys are left out of the map. */
  getWorks(keys: string[]): Promise<Map<string, CatalogWork>>
  /** Works by ISBN-10 or ISBN-13; unknown ISBNs are left out. */
  findByIsbn(isbns: string[]): Promise<Map<string, CatalogWork>>
  /** Series by key with their main sequence; unknown keys are left out. */
  getSeries(keys: string[]): Promise<Map<string, CatalogSeries>>
  /** Released works by an author, newest first. */
  worksByAuthor(author: string, limit?: number): Promise<CatalogWork[]>
  /** Works the catalog lists as similar to this one. */
  similar(key: string, limit?: number): Promise<CatalogWork[]>
  /**
   * The one work a title (with authors, ISBN or ASIN when known) names, or
   * null. Accepted only when title and an author agree with the catalog.
   */
  resolve(
    query: ResolveQuery,
  ): Promise<{ work: CatalogWork; matchedBy: MatchedBy } | null>
}
