import { Buffer } from "node:buffer"

import { type Entry, type ZipFile, fromBuffer } from "yauzl"

import { csvTable } from "./csv"
import { date, isStale, number, text } from "./parsers"
import { type HistoryStatus, type ParsedHistoryItem } from "./types"

const MAX_KINDLE_BYTES = 100 * 1024 * 1024
const SESSIONS = "kindle.devices.readingsession"
const INSIGHTS = "kindle.reading-insights-sessions_with_adjustments"
const DOCS = "kindle.kindledocs.documentmetadata"
const DIGITAL =
  /^digital\.(seriescontent\.relation|content\.ownership)(?:\.\d+)?$/

function csvKind(path: string) {
  const segments = path.toLowerCase().split("/")
  const filename = segments.pop() ?? ""
  if (!filename.endsWith(".csv")) return null
  if (filename === `${SESSIONS}.csv` || segments.includes(SESSIONS))
    return "session"
  if (filename === `${INSIGHTS}.csv` || segments.includes(INSIGHTS))
    return "insights"
  if (
    filename === `${DOCS}.csv` ||
    filename === "kindle.kindlecontentupdate.contentupdates.csv" ||
    (/^(bookrelation|ownership|contentownership|digitalcontentownership)\.csv$/.test(
      filename,
    ) &&
      segments.some((segment) => DIGITAL.test(segment))) ||
    (filename === "whispersync.csv" &&
      segments.includes("digital.content.whispersync"))
  )
    return "metadata"
  return null
}

function isKindleZip(path: string) {
  const filename = path.toLowerCase().split("/").pop() ?? ""
  if (!filename.endsWith(".zip")) return false
  const dataset = filename.slice(0, -4)
  return (
    [
      SESSIONS,
      "kindle.kindledocs",
      "kindle.readinginsights",
      "kindle.kindlecontentupdate",
      "digital.content.whispersync",
    ].includes(dataset) || DIGITAL.test(dataset)
  )
}

function openZip(zip: Buffer): Promise<ZipFile> {
  const { promise, resolve, reject } = Promise.withResolvers<ZipFile>()
  fromBuffer(
    zip,
    { lazyEntries: true, validateEntrySizes: true },
    (error, file) => {
      if (error)
        reject(new Error("Expected an Amazon Kindle data ZIP archive."))
      else resolve(file)
    },
  )
  return promise
}

async function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  const { promise, resolve, reject } =
    Promise.withResolvers<NodeJS.ReadableStream>()
  zip.openReadStream(entry, (error, stream) => {
    if (error) reject(new Error("A Kindle archive entry could not be read."))
    else resolve(stream)
  })
  const stream = await promise
  const bytes = Buffer.alloc(entry.uncompressedSize)
  let offset = 0
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    if (offset + chunk.length > bytes.length)
      throw new Error("A Kindle archive entry has an invalid size.")
    offset += chunk.copy(bytes, offset)
  }
  if (offset !== bytes.length)
    throw new Error("A Kindle archive entry is incomplete.")
  return bytes
}

/** Visit only recognized Kindle entries; never open streams for other entries. */
async function visitKindleZip(
  bytes: Buffer,
  visit: (kind: "session" | "insights" | "metadata", csv: string) => void,
  budget: { remaining: number },
  dataset?: string,
): Promise<void> {
  const zip = await openZip(bytes)
  try {
    const { promise, resolve, reject } = Promise.withResolvers<undefined>()
    zip.once("error", reject)
    zip.once("end", () => {
      resolve(undefined)
    })
    zip.on("entry", (entry: Entry) => {
      const path = dataset ? `${dataset}/${entry.fileName}` : entry.fileName
      const kind = csvKind(path)
      const nested = !dataset && isKindleZip(path)
      if (!kind && !nested) {
        zip.readEntry()
        return
      }
      budget.remaining -= entry.uncompressedSize
      if (budget.remaining < 0) {
        reject(
          new Error(
            "The Kindle archive contains more than 100 MB of reading data.",
          ),
        )
        return
      }
      void (async () => {
        const content = await readEntry(zip, entry)
        if (kind)
          visit(kind, new TextDecoder("utf-8", { fatal: true }).decode(content))
        else
          await visitKindleZip(
            content,
            visit,
            budget,
            entry.fileName.slice(entry.fileName.lastIndexOf("/") + 1, -4),
          )
        zip.readEntry()
      })().catch(reject)
    })
    zip.readEntry()
    await promise
  } finally {
    zip.close()
  }
}

type KindleBook = { title: string; authors: string[]; addedAt: string | null }
type Activity = {
  readingMillis: number
  pageFlips: number
  startedAt: string | null
  lastReadAt: string | null
}

export async function parseKindle(
  zip: Buffer,
  now: Date,
): Promise<ParsedHistoryItem[]> {
  const books = new Map<string, KindleBook>()
  const sessions = new Map<string, Activity>()
  const insights = new Map<string, Activity>()
  const seenSessions = new Set<string>()
  const archive = { hasBookData: false }
  await visitKindleZip(
    zip,
    (kind, csv) => {
      const table = csvTable(csv)
      const columns = new Map(
        table.header.map((key, index) => [
          key.toLowerCase().replace(/[^a-z0-9]/g, ""),
          index,
        ]),
      )
      const idColumn =
        columns.get("asin") ??
        columns.get("documentid") ??
        columns.get("productasin")
      const titleColumns = [
        columns.get("title"),
        columns.get("productname"),
        columns.get("booktitle"),
        columns.get("producttitle"),
      ]
      if (idColumn === undefined) return
      if (titleColumns.some((column) => column !== undefined))
        archive.hasBookData = true

      for (const row of table.rows()) {
        const id = text(row[idColumn]).toUpperCase()
        if (!id || id === "NOT AVAILABLE") continue
        const get = (key: string) => text(row[columns.get(key) ?? -1])
        if (
          /^(audio|audiobook|audible)$/i.test(
            get("contenttype") || get("producttype"),
          )
        )
          continue

        const title = titleColumns
          .map((index) => text(row[index ?? -1]))
          .find(
            (value) => value && !/^(not available|unknown|n\/a)$/i.test(value),
          )
        if (title) {
          const existing = books.get(id)
          books.set(id, {
            title: existing?.title ?? title,
            authors: existing?.authors.length
              ? existing.authors
              : (get("authors") || get("author"))
                  .split(/\s*;\s*/)
                  .filter(Boolean),
            addedAt:
              existing?.addedAt ??
              date(
                get("purchasedate") ||
                  get("creationdate") ||
                  get("acquisitiondate"),
              ),
          })
        }
        if (kind === "metadata") continue

        const readingMillis = Math.max(
          0,
          number(
            get("totalreadingmillis") || get("totalreadingmilliseconds"),
          ) ?? 0,
        )
        const pageFlips = Math.max(
          0,
          number(
            get("numberofpageflips") || get("pageflips") || get("pageturns"),
          ) ?? 0,
        )
        const startedAt = date(get("starttimestamp") || get("starttime"))
        const endedAt = date(get("endtimestamp") || get("endtime"))
        if (!readingMillis && !pageFlips && !startedAt && !endedAt) continue
        if (startedAt || endedAt) {
          const key = `${kind}/${id}/${startedAt}/${endedAt}/${readingMillis}/${pageFlips}`
          if (seenSessions.has(key)) continue
          seenSessions.add(key)
        }
        const activity = kind === "session" ? sessions : insights
        const previous = activity.get(id) ?? {
          readingMillis: 0,
          pageFlips: 0,
          startedAt: null,
          lastReadAt: null,
        }
        previous.readingMillis += readingMillis
        previous.pageFlips += pageFlips
        if (
          startedAt &&
          (!previous.startedAt || startedAt < previous.startedAt)
        )
          previous.startedAt = startedAt
        const lastReadAt = endedAt ?? startedAt
        if (
          lastReadAt &&
          (!previous.lastReadAt || lastReadAt > previous.lastReadAt)
        )
          previous.lastReadAt = lastReadAt
        activity.set(id, previous)
      }
    },
    { remaining: MAX_KINDLE_BYTES },
  )

  if (!archive.hasBookData)
    throw new Error(
      "The Kindle ZIP has no book titles. Include the Kindle.KindleDocs or digital book ownership export as well as the reading sessions.",
    )
  return Array.from(books, ([id, book]) => {
    // These datasets overlap. Prefer the per-device sessions when both report the same book.
    const activity = sessions.get(id) ?? insights.get(id)
    return {
      ...book,
      sourceId: id,
      asin: /^[A-Z0-9]{10}$/.test(id) ? id : null,
      explicit: false,
      status: !activity
        ? "owned_unread"
        : isStale(activity.lastReadAt, now)
          ? "abandoned"
          : "reading",
      startedAt: activity?.startedAt,
      readingMinutes: activity ? activity.readingMillis / 60_000 : null,
      pageFlips: activity?.pageFlips,
    }
  })
}

export function matchedKindleStatus(
  item: {
    status: HistoryStatus
    readingMinutes: number | null
    pageFlips: number | null
  },
  work: { pages: number | null; runtimeMinutes: number | null },
): HistoryStatus {
  // Roughly 250 words per page at 250 words/min, or 150 spoken vs. 250 silent words/min.
  const pages = work.pages && work.pages > 0 ? work.pages : null
  const estimatedMinutes = pages ?? (work.runtimeMinutes ?? 0) * 0.6
  return (pages !== null && (item.pageFlips ?? 0) >= pages * 0.85) ||
    (estimatedMinutes > 0 &&
      (item.readingMinutes ?? 0) >= estimatedMinutes * 0.7)
    ? "probably_read"
    : item.status
}
