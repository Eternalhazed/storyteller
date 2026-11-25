// Kept free of server imports: the web UI reads these types too.

import { type CatalogWork, type MatchedBy } from "@/catalog/types"
import { type UUID } from "@/uuid"

export const HISTORY_SOURCES = ["goodreads", "audible", "kindle"] as const
export type HistorySource = (typeof HISTORY_SOURCES)[number]

/** Imported sources plus books the reader marked read in the app. */
export type HistoryItemSource = HistorySource | "manual"

export const HISTORY_STATUSES = [
  "read",
  "reading",
  "to_read",
  "abandoned",
  "owned_unread",
  "probably_read",
] as const
export type HistoryStatus = (typeof HISTORY_STATUSES)[number]

export type MatchStatus = "pending" | "matched" | "unmatched" | "ignored"

export type ImportJobStatus = "running" | "done" | "failed"

/** One parsed row of an export, before matching. */
export type ParsedHistoryItem = {
  sourceId: string
  title: string
  authors: string[]
  narrators?: string[]
  series?: { name: string; position: number | null } | null
  isbn13?: string | null
  isbn10?: string | null
  asin?: string | null
  status: HistoryStatus
  explicit: boolean
  /** 1 to 5; null when unrated. */
  rating?: number | null
  startedAt?: string | null
  finishedAt?: string | null
  addedAt?: string | null
  /** 0 to 1. */
  progress?: number | null
  readCount?: number | null
  shelves?: string[]
  pages?: number | null
  publishedYear?: number | null
  runtimeMinutes?: number | null
  readingMinutes?: number | null
  pageFlips?: number | null
}

/** What a history row stores about its catalog match. */
export type HistoryWork = Pick<
  CatalogWork,
  "key" | "title" | "authors" | "series" | "subjects" | "releaseDate"
> & { narrators?: string[]; runtimeMinutes?: number | null }

export type ImportJobView = {
  uuid: UUID
  source: HistorySource
  status: ImportJobStatus
  total: number
  processed: number
  matched: number
  unmatched: number
  error: string | null
  /** ISO 8601, UTC. */
  createdAt: string
  finishedAt: string | null
}

export type HistorySourceSummary = {
  source: HistoryItemSource
  items: number
  matched: number
  unmatched: number
  lastImport: ImportJobView | null
}

export type UnmatchedItemView = {
  uuid: UUID
  source: HistoryItemSource
  title: string
  authors: string[]
  status: HistoryStatus
  rating: number | null
  /** Up to three catalog candidates to choose from. */
  candidates: Pick<CatalogWork, "key" | "title" | "authors" | "releaseDate">[]
}

export type HistoryLibraryRead = { bookUuid: UUID; title: string }

export type { MatchedBy }
