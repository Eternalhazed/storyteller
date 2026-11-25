import { csvTable } from "./csv"
import { type HistoryStatus, type ParsedHistoryItem } from "./types"

const STALE_MILLIS = 90 * 24 * 60 * 60 * 1000

export function isStale(date: string | null, now: Date): boolean {
  return date !== null && now.getTime() - Date.parse(date) >= STALE_MILLIS
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function number(value: unknown): number | null {
  if (typeof value !== "number" && !text(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function date(value: unknown): string | null {
  const cleaned = text(value)
    .replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, "$1-$2-$3")
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d\d:)/, "$1T$2")
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(cleaned)) return null
  const timestamp = Date.parse(
    /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(cleaned) ? `${cleaned}Z` : cleaned,
  )
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function names(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry: unknown) => text(record(entry)?.["name"] ?? entry))
        .filter(Boolean)
    : text(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
}

function isbn(value: string, length: 10 | 13): string | null {
  const digits = value
    .replace(/^="(.*)"$/, "$1")
    .replace(/[\s-]/g, "")
    .toUpperCase()
  const pattern = length === 10 ? /^\d{9}[\dX]$/ : /^\d{13}$/
  return pattern.test(digits) ? digits : null
}

export function parseGoodreads(input: string): ParsedHistoryItem[] {
  const table = csvTable(input)
  const index = new Map(
    table.header.map((header, column) => [header.trim(), column]),
  )
  const required = ["Book Id", "Title", "Author", "Exclusive Shelf"]
  if (!required.every((header) => index.has(header))) {
    throw new Error(
      "Expected a Goodreads library CSV with Book Id, Title, Author, and Exclusive Shelf columns.",
    )
  }

  const items: ParsedHistoryItem[] = []
  for (const row of table.rows()) {
    const get = (column: string) => text(row[index.get(column) ?? -1])
    const sourceId = get("Book Id")
    const exportedTitle = get("Title")
    if (!sourceId || !exportedTitle)
      throw new Error("A Goodreads record has no Book Id or title.")
    const suffix = /\s+\(([^()]+),\s*#\s*(\d+(?:\.\d+)?)\)$/.exec(exportedTitle)
    const title = suffix ? exportedTitle.slice(0, suffix.index) : exportedTitle
    const author = get("Author") || get("Author l-f")
    const shelves = names(get("Bookshelves"))
    const shelf = get("Exclusive Shelf").toLowerCase()
    const abandoned = [shelf, ...shelves].some((value) =>
      /^(dnf|abandoned|did[-_\s]+not[-_\s]+finish)$/i.test(value),
    )
    const status: HistoryStatus = abandoned
      ? "abandoned"
      : shelf === "read"
        ? "read"
        : shelf === "currently-reading"
          ? "reading"
          : "to_read"
    const rating = number(get("My Rating"))
    items.push({
      sourceId,
      title,
      authors: [
        ...new Set(
          [author, ...names(get("Additional Authors"))].filter(Boolean),
        ),
      ],
      series: suffix?.[1]
        ? { name: suffix[1].trim(), position: Number(suffix[2]) }
        : null,
      isbn10: isbn(get("ISBN"), 10),
      isbn13: isbn(get("ISBN13"), 13),
      status,
      explicit: true,
      rating: rating !== null && rating >= 1 && rating <= 5 ? rating : null,
      finishedAt: date(get("Date Read")),
      addedAt: date(get("Date Added")),
      readCount: number(get("Read Count")),
      shelves,
      pages: number(get("Number of Pages")),
      publishedYear: number(get("Original Publication Year")),
    })
  }
  return items
}

export function parseAudible(input: string, now: Date): ParsedHistoryItem[] {
  let decoded: unknown
  try {
    decoded = JSON.parse(input.replace(/^\uFEFF/, ""))
  } catch {
    throw new Error(
      "Expected Audible library JSON from audible-cli library export -f json.",
    )
  }
  const entries: unknown = Array.isArray(decoded)
    ? decoded
    : record(decoded)?.["items"]
  if (!Array.isArray(entries))
    throw new Error("The Audible library export must contain a list of books.")

  return entries.map((entry: unknown) => {
    const row = record(entry)
    const asin = text(row?.["asin"]).toUpperCase()
    const title = text(row?.["title"])
    if (!row || !asin || !title)
      throw new Error("An Audible record has no ASIN or title.")
    const finished =
      row["is_finished"] === true ||
      row["is_finished"] === 1 ||
      /^(true|1)$/i.test(text(row["is_finished"]))
    const percent = Math.min(
      100,
      Math.max(0, number(row["percent_complete"]) ?? 0),
    )
    const addedAt = date(row["purchase_date"]) ?? date(row["date_added"])
    const lastActive =
      date(row["last_listened_at"]) ??
      date(row["last_played_at"]) ??
      date(row["last_read_at"]) ??
      date(row["last_updated_at"]) ??
      addedAt
    const status: HistoryStatus =
      finished || percent >= 97
        ? "read"
        : percent === 0
          ? "owned_unread"
          : isStale(lastActive, now)
            ? "abandoned"
            : "reading"
    const series = text(row["series_title"])
    return {
      sourceId: asin,
      asin,
      title,
      authors: names(row["authors"]),
      narrators: names(row["narrators"]),
      series: series
        ? { name: series, position: number(row["series_sequence"]) }
        : null,
      runtimeMinutes: number(row["runtime_length_min"]),
      status,
      explicit: finished,
      addedAt,
      progress: (finished ? 100 : percent) / 100,
    }
  })
}
