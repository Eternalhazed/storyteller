import { createHash } from "node:crypto"

import {
  authorKey,
  normalizeText,
  primarySeries,
  workIdentity,
} from "@/catalog/normalize"
import { getBookRequestsForUser } from "@/database/bookRequests"
import { getBooks } from "@/database/books"
import { db } from "@/database/connection"
import { getHistoryItems } from "@/database/readingHistory"
import { getAllPicks } from "@/database/recommendations"
import { type HistoryItemSource, type HistoryStatus } from "@/history/types"
import { type UUID } from "@/uuid"

import { referenceDate, sqlTime } from "./clock"
import { type RecommendationPreferences } from "./types"

/** What a reader has done with one book, merged across every source. */
export type ReaderBook = {
  identity: string
  title: string
  authors: string[]
  narrators: string[]
  series: { name: string; key: string | null; position: number | null } | null
  /** `library` is a book on the reader's shelves with no status. */
  status: HistoryStatus | "library"
  explicit: boolean
  /** 0 to 5; null when unrated. */
  rating: number | null
  /** `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DD`; when finished, else when last touched. */
  at: string | null
  subjects: string[]
  pages: number | null
  runtimeMinutes: number | null
  catalogKey: string | null
  sources: (HistoryItemSource | "storyteller")[]
  inLibrary: boolean
  bookUuid: UUID | null
  listened: boolean
}

export type ReaderData = {
  userId: UUID
  books: ReaderBook[]
  byIdentity: Map<string, ReaderBook>
  /** Identities the reader asked for (any request). */
  requested: Set<string>
  /** Identities turned down for good, with the reason. */
  notForMe: Map<string, string | null>
  /** Identities resting until a date. */
  restedUntil: Map<string, string>
  /** Titles the reader put off ("Not now"). */
  notNow: string[]
  /** Identities shown in each of the last two weekly rounds and left alone. */
  ignoredTwice: Set<string>
}

const STATUS_BY_NAME: Record<string, HistoryStatus> = {
  read: "read",
  reading: "reading",
  "to read": "to_read",
}

/** How sure a status is: explicit beats derived; read beats reading. */
function statusWeight(book: Pick<ReaderBook, "explicit" | "status">): number {
  const order: Record<ReaderBook["status"], number> = {
    read: 6,
    abandoned: 5,
    reading: 4,
    probably_read: 3,
    to_read: 2,
    owned_unread: 1,
    library: 0,
  }
  return (book.explicit ? 10 : 0) + order[book.status]
}

function merge(into: ReaderBook, other: ReaderBook): ReaderBook {
  const stronger =
    statusWeight(other) > statusWeight(into) ||
    (statusWeight(other) === statusWeight(into) &&
      (other.at ?? "") > (into.at ?? ""))
  const base = stronger ? other : into
  const rest = stronger ? into : other
  return {
    ...base,
    narrators: base.narrators.length ? base.narrators : rest.narrators,
    series: base.series ?? rest.series,
    rating: base.rating ?? rest.rating,
    subjects: [...new Set([...base.subjects, ...rest.subjects])],
    pages: base.pages ?? rest.pages,
    runtimeMinutes: base.runtimeMinutes ?? rest.runtimeMinutes,
    catalogKey: base.catalogKey ?? rest.catalogKey,
    sources: [...new Set([...base.sources, ...rest.sources])],
    inLibrary: base.inLibrary || rest.inLibrary,
    bookUuid: base.bookUuid ?? rest.bookUuid,
    listened: base.listened || rest.listened,
  }
}

/**
 * Everything the reader has done that recommendations use: their library
 * and statuses, imported history (unless they turned it off), requests and
 * feedback on earlier picks. Only this reader's rows are read.
 */
export async function loadReaderData(
  userId: UUID,
  prefs: RecommendationPreferences,
): Promise<ReaderData> {
  const [library, statusTimes, history, requests, picks] = await Promise.all([
    getBooks(null, userId),
    db
      .selectFrom("bookToStatus")
      .select(["bookUuid", "updatedAt"])
      .where("userId", "=", userId)
      .execute(),
    getHistoryItems(userId, prefs.useHistory ? {} : { sources: ["manual"] }),
    getBookRequestsForUser(userId),
    getAllPicks(userId),
  ])
  const statusAt = new Map(
    statusTimes.map((row) => [row.bookUuid, row.updatedAt]),
  )

  const entries: ReaderBook[] = []
  for (const book of library) {
    const authors = book.authors.map((author) => author.name)
    const series = book.series[0]
    const status = book.status
      ? (STATUS_BY_NAME[book.status.name.toLowerCase()] ?? "library")
      : "library"
    entries.push({
      identity: workIdentity(book.title, authors),
      title: book.title,
      authors,
      narrators: book.narrators.map((narrator) => narrator.name),
      series: series
        ? {
            name: series.name,
            key: null,
            position: series.position ?? null,
          }
        : null,
      status,
      explicit: status !== "library",
      rating: book.userBookRating?.rating ?? null,
      at: statusAt.get(book.uuid) ?? null,
      subjects: book.tags.map((tag) => tag.name),
      pages: null,
      runtimeMinutes: null,
      catalogKey: null,
      sources: ["storyteller"],
      inLibrary: true,
      bookUuid: book.uuid,
      listened: !!book.audiobook,
    })
  }
  const cutoff = referenceDate()
  for (const item of history) {
    if (item.matchStatus === "ignored") continue
    // The backtest's "today": what happened later is not known yet.
    if (cutoff && (item.addedAt ?? item.finishedAt ?? "") >= cutoff) continue
    const work = item.work
    const title = work?.title ?? item.title
    const authors = work?.authors.length ? work.authors : item.authors
    const series = primarySeries(work?.series ?? [], item.series?.name)
    // Added before the cutoff, finished after: still on the to-read list then.
    const later = !!cutoff && !!item.finishedAt && item.finishedAt >= cutoff
    entries.push({
      identity: workIdentity(title, authors),
      title,
      authors,
      narrators: item.narrators.length
        ? item.narrators
        : (work?.narrators ?? []),
      series: series
        ? {
            name: series.name,
            key: series.key || null,
            position: series.position,
          }
        : item.series
          ? {
              name: item.series.name,
              key: null,
              position: item.series.position,
            }
          : null,
      status: later ? "to_read" : item.status,
      explicit: item.explicit,
      rating: !later && item.rating && item.rating > 0 ? item.rating : null,
      at: later
        ? item.addedAt
        : (item.finishedAt ?? item.startedAt ?? item.addedAt),
      subjects: work?.subjects ?? [],
      pages: item.pages,
      runtimeMinutes: item.runtimeMinutes ?? work?.runtimeMinutes ?? null,
      catalogKey: work?.key ?? null,
      sources: [item.source],
      inLibrary: false,
      bookUuid: item.bookUuid,
      listened: item.source === "audible",
    })
  }

  const byIdentity = new Map<string, ReaderBook>()
  for (const entry of entries) {
    const existing = byIdentity.get(entry.identity)
    byIdentity.set(entry.identity, existing ? merge(existing, entry) : entry)
  }

  const requested = new Set(
    requests.map((request) =>
      workIdentity(request.chosenWork.title, request.chosenWork.authors),
    ),
  )

  const now = sqlTime()
  const notForMe = new Map<string, string | null>()
  const restedUntil = new Map<string, string>()
  const notNow: string[] = []
  for (const pick of picks) {
    if (pick.state === "not_for_me" && !notForMe.has(pick.workIdentity)) {
      notForMe.set(pick.workIdentity, pick.stateReason)
    }
    if (pick.restedUntil && pick.restedUntil > now) {
      const current = restedUntil.get(pick.workIdentity)
      if (!current || current < pick.restedUntil) {
        restedUntil.set(pick.workIdentity, pick.restedUntil)
      }
      if (pick.state === "not_now") notNow.push(pick.work.title)
    }
  }

  return {
    userId,
    books: [...byIdentity.values()],
    byIdentity,
    requested,
    notForMe,
    restedUntil,
    notNow,
    ignoredTwice: await ignoredInLastTwoWeekly(userId),
  }
}

/** Picks shown, untouched, in each of the reader's last two weekly rounds. */
async function ignoredInLastTwoWeekly(userId: UUID): Promise<Set<string>> {
  const rounds = await db
    .selectFrom("recommendationRound")
    .select("uuid")
    .where("userId", "=", userId)
    .where("trigger", "=", "weekly")
    .where("status", "=", "done")
    .orderBy("createdAt", "desc")
    .limit(2)
    .execute()
  if (rounds.length < 2) return new Set()
  const rows = await db
    .selectFrom("recommendation")
    .select(["roundUuid", "workIdentity"])
    .where(
      "roundUuid",
      "in",
      rounds.map((round) => round.uuid),
    )
    .where("state", "=", "new")
    .execute()
  const [newer, older] = rounds.map(
    (round) =>
      new Set(
        rows
          .filter((row) => row.roundUuid === round.uuid)
          .map((row) => row.workIdentity),
      ),
  )
  if (!newer || !older) return new Set()
  return new Set([...newer].filter((identity) => older.has(identity)))
}

/** Read, explicitly or by the reader's own word, in any source. */
export function isRead(book: ReaderBook): boolean {
  return (
    (book.status === "read" || book.status === "abandoned") && book.explicit
  )
}

export type ProfileSeries = {
  name: string
  key: string | null
  authors: string[]
  readPositions: number[]
  meanRating: number | null
  lastActivity: string | null
  /** following: ≥ 2 read; started: 1 read; dropped: abandoned or rated low. */
  state: "following" | "started" | "dropped"
}

/** The compact summary of a reader the model sees. */
export type ReaderProfile = {
  version: 1
  counts: { read: number; rated: number; toRead: number; abandoned: number }
  lovedAuthors: {
    name: string
    mean: number
    count: number
    lastRead: string | null
  }[]
  avoidedAuthors: { name: string; mean: number; count: number }[]
  lovedBooks: {
    title: string
    author: string
    rating: number
    series: string | null
  }[]
  series: ProfileSeries[]
  narrators: { name: string; books: number; fiveStar: number }[]
  lengths: {
    medianPagesFinished: number | null
    medianHoursFinished: number | null
    medianPagesAbandoned: number | null
  }
  subjects: { name: string; weight: number }[]
  formats: { listened: number; read: number }
  now: { reading: string[]; lastFinished: string[] }
  feedback: {
    notForMe: { title: string; reason: string | null }[]
    notNow: string[]
  }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

function mean(values: number[]): number | null {
  return values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : null
}

/** Too little to go on: the interview comes first. */
export function isColdStart(data: ReaderData): boolean {
  return (
    data.books.filter((book) => isRead(book) || book.rating != null).length < 5
  )
}

export function buildProfile(
  data: ReaderData,
  picks: { title: string; reason: string | null }[] = [],
): ReaderProfile {
  const read = data.books.filter(isRead).filter((b) => b.status === "read")
  const rated = data.books.filter((book) => book.rating != null)

  const byAuthor = new Map<
    string,
    { name: string; ratings: number[]; count: number; last: string | null }
  >()
  for (const book of data.books) {
    if (!isRead(book) && book.rating == null) continue
    const name = book.authors[0]
    if (!name) continue
    const key = authorKey(name)
    const entry = byAuthor.get(key) ?? {
      name,
      ratings: [],
      count: 0,
      last: null,
    }
    entry.count++
    if (book.rating != null) entry.ratings.push(book.rating)
    if ((book.at ?? "") > (entry.last ?? "")) entry.last = book.at
    byAuthor.set(key, entry)
  }
  const authors = [...byAuthor.values()].map((entry) => ({
    name: entry.name,
    mean: mean(entry.ratings),
    count: entry.count,
    lastRead: entry.last,
  }))

  const seriesMap = new Map<
    string,
    ProfileSeries & { ratings: number[]; dropped: boolean }
  >()
  for (const book of data.books) {
    if (!book.series) continue
    const id = normalizeText(book.series.name)
    const entry = seriesMap.get(id) ?? {
      name: book.series.name,
      key: book.series.key,
      authors: book.authors.slice(0, 1),
      readPositions: [],
      meanRating: null,
      lastActivity: null,
      state: "started" as const,
      ratings: [],
      dropped: false,
    }
    entry.key ??= book.series.key
    if (
      isRead(book) &&
      book.status === "read" &&
      book.series.position != null
    ) {
      entry.readPositions.push(book.series.position)
    }
    if (book.status === "abandoned") entry.dropped = true
    if (book.rating != null) entry.ratings.push(book.rating)
    if ((book.at ?? "") > (entry.lastActivity ?? ""))
      entry.lastActivity = book.at
    seriesMap.set(id, entry)
  }
  const series: ProfileSeries[] = [...seriesMap.values()]
    .filter((entry) => entry.readPositions.length || entry.dropped)
    .map(({ ratings, dropped, ...entry }): ProfileSeries => {
      const meanRating = mean(ratings)
      return {
        ...entry,
        readPositions: [...new Set(entry.readPositions)].sort((a, b) => a - b),
        meanRating,
        state:
          dropped || (meanRating != null && meanRating <= 2.5)
            ? "dropped"
            : entry.readPositions.length >= 2
              ? "following"
              : "started",
      }
    })
    .sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""))

  const narratorMap = new Map<
    string,
    { name: string; books: number; fiveStar: number }
  >()
  for (const book of data.books) {
    if (!book.listened || !isRead(book)) continue
    for (const name of book.narrators) {
      const entry = narratorMap.get(name) ?? { name, books: 0, fiveStar: 0 }
      entry.books++
      if ((book.rating ?? 0) >= 4.75) entry.fiveStar++
      narratorMap.set(name, entry)
    }
  }

  const subjectWeights = new Map<string, number>()
  for (const book of data.books) {
    if (!isRead(book) && book.status !== "reading") continue
    const weight =
      book.rating == null
        ? 1
        : book.rating >= 4
          ? 2
          : book.rating <= 2
            ? -1
            : 0.5
    // Catalog subjects run from broad to specific ("Literature & Fiction" …
    // "Sea Adventures"); the broad ones say nothing about taste.
    for (const subject of book.subjects.slice(-2)) {
      subjectWeights.set(subject, (subjectWeights.get(subject) ?? 0) + weight)
    }
  }

  const finished = read
    .filter((book) => book.at)
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))

  return {
    version: 1,
    counts: {
      read: read.length,
      rated: rated.length,
      toRead: data.books.filter((book) => book.status === "to_read").length,
      abandoned: data.books.filter((book) => book.status === "abandoned")
        .length,
    },
    lovedAuthors: authors
      .filter(
        (author) =>
          (author.mean ?? 0) >= 4 || (author.mean == null && author.count >= 3),
      )
      .sort((a, b) => b.count * (b.mean ?? 3.5) - a.count * (a.mean ?? 3.5))
      .slice(0, 20)
      .map((author) => ({ ...author, mean: author.mean ?? 0 })),
    avoidedAuthors: authors
      .filter((author) => author.mean != null && author.mean <= 2.5)
      .slice(0, 10)
      .map((author) => ({
        name: author.name,
        mean: author.mean ?? 0,
        count: author.count,
      })),
    lovedBooks: rated
      .filter((book) => (book.rating ?? 0) >= 4.5)
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
      .slice(0, 25)
      .map((book) => ({
        title: book.title,
        author: book.authors[0] ?? "",
        rating: book.rating ?? 0,
        series: book.series
          ? `${book.series.name}${book.series.position != null ? ` #${book.series.position}` : ""}`
          : null,
      })),
    series: series.slice(0, 40),
    narrators: [...narratorMap.values()]
      .sort((a, b) => b.fiveStar - a.fiveStar || b.books - a.books)
      .slice(0, 10),
    lengths: {
      medianPagesFinished: median(
        read.flatMap((book) => (book.pages ? [book.pages] : [])),
      ),
      medianHoursFinished: median(
        read.flatMap((book) =>
          book.runtimeMinutes ? [Math.round(book.runtimeMinutes / 6) / 10] : [],
        ),
      ),
      medianPagesAbandoned: median(
        data.books
          .filter((book) => book.status === "abandoned")
          .flatMap((book) => (book.pages ? [book.pages] : [])),
      ),
    },
    subjects: [...subjectWeights.entries()]
      .filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, weight]) => ({
        name,
        weight: Math.round(weight * 10) / 10,
      })),
    formats: {
      listened: data.books.filter((book) => isRead(book) && book.listened)
        .length,
      read: data.books.filter((book) => isRead(book) && !book.listened).length,
    },
    now: {
      reading: data.books
        .filter((book) => book.status === "reading" && book.explicit)
        .slice(0, 5)
        .map((book) => book.title),
      lastFinished: finished.slice(0, 5).map((book) => book.title),
    },
    feedback: {
      notForMe: picks.slice(0, 20),
      notNow: data.notNow.slice(0, 20),
    },
  }
}

/** Build and store a reader's profile; returns it. */
export async function rebuildProfile(
  userId: UUID,
  prefs: RecommendationPreferences,
): Promise<{ profile: ReaderProfile; data: ReaderData }> {
  const data = await loadReaderData(userId, prefs)
  const notForMe = (await getAllPicks(userId))
    .filter((pick) => pick.state === "not_for_me")
    .map((pick) => ({ title: pick.work.title, reason: pick.stateReason }))
  const profile = buildProfile(data, notForMe)
  const json = JSON.stringify(profile)
  const inputHash = createHash("sha256").update(json).digest("hex")
  await db
    .insertInto("readerProfile")
    .values({ userId, profile: json, inputHash })
    .onConflict((oc) =>
      oc.column("userId").doUpdateSet({
        profile: json,
        inputHash,
        builtAt: sqlTime(),
      }),
    )
    .execute()
  return { profile, data }
}
