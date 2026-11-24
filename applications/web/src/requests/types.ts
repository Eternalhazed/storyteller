import { type UUID } from "@/uuid"

export const REQUEST_KINDS = [
  "gap",
  "successor",
  "title",
  "add_format",
] as const
export type RequestKind = (typeof REQUEST_KINDS)[number]

/** What the reader started from: a series gap, a book to follow, typed text. */
export type RequestInput = {
  seriesUuid?: UUID | null
  seriesName?: string | null
  position?: number | null
  sourceBookUuid?: UUID | null
  text?: string | null
}

/** The book the reader confirmed. */
export type ChosenWork = {
  title: string
  authors: string[]
  series?: { name: string; position: number | null } | null
  /** Other titles the same work is sold under, used to pair releases. */
  altTitles?: string[]
  /** The language the reader wants it in, as a BCP 47 tag, when known. */
  language?: string | null
  /** Catalog identifiers, e.g. `{ asin: "…", hardcover: "…" }`. */
  ids?: Record<string, string>
}

export const REQUEST_FORMATS = ["ebook", "audio"] as const
export type RequestFormat = (typeof REQUEST_FORMATS)[number]

export const FORMAT_STATUSES = [
  "none",
  "choosing",
  "downloading",
  "stalled",
  "importing",
  "ready",
  "failed",
] as const
export type FormatStatus = (typeof FORMAT_STATUSES)[number]

export const ALIGN_STATUSES = [
  "none",
  "queued",
  "syncing",
  "paused",
  "done",
  "failed",
] as const
export type AlignStatus = (typeof ALIGN_STATUSES)[number]

/**
 * Notifications sent at most once per request: the first readable format,
 * the finished sync, and anything that needs the reader.
 */
export type Milestone =
  | "readable"
  | "synced"
  | "sync-failed"
  | `${RequestFormat}-stalled`
  | `${RequestFormat}-failed`
  | `${RequestFormat}-choosing`

/**
 * Where a fact about a release came from. `field` is a structured field of
 * the source (a narrator field, a tag, a file type), `files` is the torrent's
 * file list. A fact nothing supports is `null` and shown as unknown.
 */
export type FactSource = "field" | "files"

export type Fact<T> = { value: T; source: FactSource } | null

export type ReleaseFile = { path: string; size: number }

/**
 * One downloadable release, as an acquisition adapter reports it. The adapter
 * fills in facts only from structured fields or the file list; anything else
 * stays null.
 */
export type Release = {
  /** Which source the release comes from, as the adapter names it. */
  source: string
  /** The source's own id for the release. */
  id: string
  kind: RequestFormat
  title: string
  authors: string[]
  seeders: number
  size: number | null
  /** Present once inspected, or when the source lists it. */
  infohash: string | null
  files: ReleaseFile[] | null
  facts: {
    narrators: Fact<string[]>
    abridged: Fact<boolean>
    dramatized: Fact<boolean>
    language: Fact<string>
    /** File types, lower case without the dot, e.g. `["m4b"]`. */
    fileTypes: Fact<string[]>
    bitrateKbps: Fact<number>
    durationSeconds: Fact<number>
    /** More than one book in the release. */
    pack: Fact<boolean>
    series: Fact<{ name: string; position: number | null }>
    publishedYear: Fact<number>
  }
}

/** What a request stores about the release chosen for one format. */
export type ChosenRelease = Pick<
  Release,
  "source" | "id" | "kind" | "title" | "seeders" | "size" | "facts"
>

/** A torrent as the adapter's download client reports it. */
export type TorrentStatus = {
  infohash: string
  /** 0 to 1. */
  progress: number
  bytesDone: number
  seedersConnected: number
  state: "downloading" | "seeding" | "paused" | "checking" | "error" | "queued"
  /**
   * The torrent's folder relative to the seed root, or null when it stores
   * its files somewhere else (a torrent that was already in the client).
   */
  folder: string | null
  /** Paths relative to `folder`. */
  files: ReleaseFile[]
}
