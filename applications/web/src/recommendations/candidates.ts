import {
  authorKey,
  normalizeText,
  primarySeries,
  workIdentity,
} from "@/catalog/normalize"
import {
  type Catalog,
  type CatalogSeries,
  type CatalogWork,
} from "@/catalog/types"

import { referenceDate, sqlTime } from "./clock"
import { type Proposal } from "./model"
import {
  type ProfileSeries,
  type ReaderData,
  type ReaderProfile,
  isRead,
} from "./reader"
import { type Evidence, type Section } from "./types"

export type CandidateOrigin =
  | "series"
  | "to_read"
  | "owned"
  | "author"
  | "similar"
  | "proposal"
  | "stretch"

export type Candidate = {
  work: CatalogWork
  identity: string
  section: Section
  origin: CandidateOrigin
  /** Facts about this candidate the reasons may cite. */
  evidence: Evidence[]
  /** The candidate's main series, when it has one in the catalog. */
  series: { catalog: CatalogSeries; position: number } | null
  pill: "new" | "stretch" | null
  note: string | null
  /** Subtracted before ranking (e.g. Kindle says it may be read already). */
  softPenalty: number
  /** Order hint for code-ranked sections, higher first. */
  prior: number
}

/** Numbered facts for one round; ids are only meaningful within it. */
export class EvidenceBook {
  readonly items: Evidence[] = []
  add(kind: string, text: string): Evidence {
    const existing = this.items.find((item) => item.text === text)
    if (existing) return existing
    const item = { id: `e${this.items.length + 1}`, kind, text }
    this.items.push(item)
    return item
  }
  has(id: string): boolean {
    return this.items.some((item) => item.id === id)
  }
  get(id: string): Evidence | undefined {
    return this.items.find((item) => item.id === id)
  }
}

function stars(rating: number): string {
  return `${Math.round(rating * 10) / 10}★`
}

/** Facts about the reader any reason may cite. */
export function globalEvidence(
  profile: ReaderProfile,
  evidence: EvidenceBook,
): void {
  for (const author of profile.lovedAuthors.slice(0, 10)) {
    evidence.add(
      "loved-author",
      `${author.name}: ${author.count} book${author.count === 1 ? "" : "s"} read${
        author.mean ? `, average ${stars(author.mean)}` : ""
      }`,
    )
  }
  for (const book of profile.lovedBooks.slice(0, 12)) {
    evidence.add(
      "loved-book",
      `${book.title} by ${book.author}: rated ${stars(book.rating)}`,
    )
  }
  for (const subject of profile.subjects.slice(0, 8)) {
    evidence.add("subject", `Reads a lot of ${subject.name}`)
  }
  for (const narrator of profile.narrators.slice(0, 5)) {
    if (narrator.fiveStar) {
      evidence.add(
        "narrator",
        `${narrator.name} narrated ${narrator.fiveStar} listen${narrator.fiveStar === 1 ? "" : "s"} rated 5★`,
      )
    }
  }
}

function today(): string {
  return referenceDate() ?? new Date().toISOString().slice(0, 10)
}

export function isReleased(work: CatalogWork): boolean {
  return !work.releaseDate || work.releaseDate <= today()
}

/** The reader reads it in a language they read: English unless shown otherwise. */
export function readableLanguage(work: CatalogWork): boolean {
  return !work.language || work.language.toLowerCase().startsWith("en")
}

/** Main-sequence positions of a catalog series the reader has read. */
function readPositions(series: CatalogSeries, data: ReaderData): Set<number> {
  const read = new Set<number>()
  for (const entry of series.books) {
    const book = data.byIdentity.get(
      workIdentity(entry.work.title, entry.work.authors),
    )
    if (book && isRead(book)) read.add(entry.position)
  }
  return read
}

/**
 * Where the reader should start a series: the first released main book they
 * have not read. Null when they have read every released book.
 */
export function entryPoint(
  series: CatalogSeries,
  data: ReaderData,
): { position: number; work: CatalogWork } | null {
  const read = readPositions(series, data)
  return (
    series.books.find(
      (entry) => !read.has(entry.position) && isReleased(entry.work),
    ) ?? null
  )
}

/** Attach series data and move a mid-series pick to the reader's entry point. */
export async function placeInSeries(
  candidates: Candidate[],
  catalog: Catalog,
  data: ReaderData,
): Promise<Candidate[]> {
  const keys = [
    ...new Set(
      candidates.flatMap((candidate) => {
        const ref = primarySeries(candidate.work.series)
        return ref ? [ref.key] : []
      }),
    ),
  ]
  const series = keys.length
    ? await catalog.getSeries(keys)
    : new Map<string, CatalogSeries>()
  const out: Candidate[] = []
  for (const candidate of candidates) {
    const ref = primarySeries(candidate.work.series)
    const found = ref ? series.get(ref.key) : undefined
    if (!found) {
      out.push({ ...candidate, series: null })
      continue
    }
    const own = found.books.find(
      (entry) =>
        entry.work.key === candidate.work.key ||
        workIdentity(entry.work.title, entry.work.authors) ===
          candidate.identity,
    )
    const entry = entryPoint(found, data)
    if (!entry) continue // every released book read
    if (own && own.position > entry.position) {
      // Book 5 is no place to start: offer the first unread book instead.
      out.push({
        ...candidate,
        work: entry.work,
        identity: workIdentity(entry.work.title, entry.work.authors),
        series: { catalog: found, position: entry.position },
        note:
          candidate.origin === "to_read" || candidate.origin === "owned"
            ? `Book ${own.position}, ${candidate.work.title}, is on your list; this is where the series picks up for you.`
            : candidate.note,
      })
      continue
    }
    out.push({
      ...candidate,
      series: own ? { catalog: found, position: own.position } : null,
    })
  }
  return out
}

/** Followed and started series: the next unread main book of each. */
export async function seriesCandidates(
  profile: ReaderProfile,
  data: ReaderData,
  catalog: Catalog,
  evidence: EvidenceBook,
  onlySeries?: (series: ProfileSeries) => boolean,
): Promise<Candidate[]> {
  const wanted = profile.series.filter(
    (series) =>
      series.state !== "dropped" && (!onlySeries || onlySeries(series)),
  )
  const keys = await seriesKeys(wanted, data, catalog)
  const found = keys.size
    ? await catalog.getSeries([...new Set(keys.values())])
    : new Map<string, CatalogSeries>()
  const out: Candidate[] = []
  for (const series of wanted) {
    const key = keys.get(series)
    const catalogSeries: CatalogSeries | undefined = key
      ? found.get(key)
      : undefined
    if (!catalogSeries) continue
    const entry = entryPoint(catalogSeries, data)
    if (!entry) continue
    const identity = workIdentity(entry.work.title, entry.work.authors)
    const lastActivity = series.lastActivity ?? ""
    const fresh =
      !!entry.work.releaseDate &&
      entry.work.releaseDate > lastActivity.slice(0, 10)
    const read = series.readPositions
    const fact = evidence.add(
      "series-progress",
      `${series.name}: you read ${describePositions(read)}${
        series.meanRating != null ? `, average ${stars(series.meanRating)}` : ""
      }`,
    )
    const items = [fact]
    if (fresh && read.length) {
      items.push(
        evidence.add(
          "new-release",
          `${series.name} #${entry.position} came out ${entry.work.releaseDate}, after you last read the series`,
        ),
      )
    }
    out.push({
      work: entry.work,
      identity,
      section: "series",
      origin: "series",
      evidence: items,
      series: { catalog: catalogSeries, position: entry.position },
      pill: fresh && read.length ? "new" : null,
      note: null,
      softPenalty: 0,
      prior:
        (series.meanRating ?? 3.5) * 10 +
        (series.state === "following" ? 10 : 0) +
        recency(series.lastActivity),
    })
  }
  return out
}

function describePositions(positions: number[]): string {
  if (!positions.length) return "some of it"
  const sorted = [...positions].sort((a, b) => a - b)
  const contiguous = sorted.every(
    (value, index) => index === 0 || value === (sorted[index - 1] ?? 0) + 1,
  )
  if (contiguous && sorted.length > 1) return `#${sorted[0]}–${sorted.at(-1)}`
  return sorted.map((value) => `#${value}`).join(", ")
}

/** 0 to 10: more for series touched recently. */
function recency(at: string | null): number {
  if (!at) return 0
  const days =
    (Date.now() -
      Date.parse(at.replace(" ", "T") + (at.length <= 10 ? "" : "Z"))) /
    86_400_000
  if (!Number.isFinite(days)) return 0
  return Math.max(0, 10 - days / 60)
}

/**
 * The catalog key of each series: from a matched history row, else by
 * looking up the reader's latest book in it.
 */
async function seriesKeys(
  wanted: ProfileSeries[],
  data: ReaderData,
  catalog: Catalog,
): Promise<Map<ProfileSeries, string>> {
  const out = new Map<ProfileSeries, string>()
  for (const series of wanted) {
    if (series.key) {
      out.set(series, series.key)
      continue
    }
    const book = data.books
      .filter(
        (each) =>
          each.series &&
          normalizeText(each.series.name) === normalizeText(series.name),
      )
      .sort((a, b) => (b.series?.position ?? 0) - (a.series?.position ?? 0))[0]
    if (!book) continue
    const resolved = await catalog.resolve({
      title: book.title,
      authors: book.authors,
    })
    const key = primarySeries(resolved?.work.series ?? [], series.name)?.key
    if (key) out.set(series, key)
  }
  return out
}

/** Goodreads to-read and books owned elsewhere but not in the library. */
export async function listCandidates(
  data: ReaderData,
  catalog: Catalog,
  evidence: EvidenceBook,
): Promise<Candidate[]> {
  const listed = data.books
    .flatMap((book) =>
      !book.inLibrary &&
      book.catalogKey &&
      (book.status === "to_read" || book.status === "owned_unread")
        ? [{ ...book, catalogKey: book.catalogKey }]
        : [],
    )
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 25)
  const works = await catalog.getWorks(listed.map((book) => book.catalogKey))
  const out: Candidate[] = []
  for (const book of listed) {
    const work = works.get(book.catalogKey)
    if (!work) continue
    const owned = book.status === "owned_unread"
    const source = book.sources.find((s) => s !== "storyteller") ?? "list"
    const where =
      source === "goodreads"
        ? "your Goodreads to-read"
        : source === "audible"
          ? "Audible"
          : source === "kindle"
            ? "Kindle"
            : "your list"
    const fact = evidence.add(
      owned ? "owned" : "to-read",
      owned
        ? `You own ${work.title} on ${where}`
        : `${work.title} is on ${where}${book.at ? ` since ${book.at.slice(0, 4)}` : ""}`,
    )
    out.push({
      work,
      identity: workIdentity(work.title, work.authors),
      section: "lists",
      origin: owned ? "owned" : "to_read",
      evidence: [fact],
      series: null,
      pill: null,
      note: null,
      softPenalty: 0,
      prior: recency(book.at),
    })
  }
  return out
}

/** Unread books by authors the reader rates highly. */
export async function authorCandidates(
  profile: ReaderProfile,
  catalog: Catalog,
  evidence: EvidenceBook,
): Promise<Candidate[]> {
  const loved = profile.lovedAuthors
    .filter((author) => author.mean >= 4.3 && author.count >= 2)
    .slice(0, 8)
  const out: Candidate[] = []
  for (const author of loved) {
    const works = await catalog.worksByAuthor(author.name, 20)
    const fact = evidence.add(
      "loved-author",
      `${author.name}: ${author.count} books read, average ${stars(author.mean)}`,
    )
    for (const work of works) {
      if (
        !work.authors.some((name) => authorKey(name) === authorKey(author.name))
      )
        continue
      out.push({
        work,
        identity: workIdentity(work.title, work.authors),
        section: "discover",
        origin: "author",
        evidence: [fact],
        series: null,
        pill: null,
        note: null,
        softPenalty: 0,
        prior: author.mean * 10,
      })
    }
  }
  return out
}

/** Works the catalog lists as similar to books the reader loved. */
export async function similarCandidates(
  seeds: { key: string; title: string; rating: number | null }[],
  catalog: Catalog,
  evidence: EvidenceBook,
  section: Section,
  perSeed: number,
): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const seed of seeds) {
    const fact = evidence.add(
      "similar",
      `Listed by the catalog as similar to ${seed.title}${seed.rating != null ? ` (you rated it ${stars(seed.rating)})` : ""}`,
    )
    for (const work of await catalog.similar(seed.key, perSeed)) {
      out.push({
        work,
        identity: workIdentity(work.title, work.authors),
        section,
        origin: "similar",
        evidence: [fact],
        series: null,
        pill: null,
        note: null,
        softPenalty: 0,
        prior: 0,
      })
    }
  }
  return out
}

/** Model proposals that the catalog confirms; the rest are dropped. */
export async function verifyProposals(
  proposals: Proposal[],
  catalog: Catalog,
  section: Section,
  extra: (proposal: Proposal) => Evidence[],
): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const proposal of proposals) {
    const resolved = await catalog.resolve({
      title: proposal.title,
      authors: [proposal.author],
    })
    if (!resolved) continue
    const stretch = proposal.kind === "stretch"
    out.push({
      work: resolved.work,
      identity: workIdentity(resolved.work.title, resolved.work.authors),
      section,
      origin: stretch ? "stretch" : "proposal",
      evidence: extra(proposal),
      series: null,
      pill: stretch ? "stretch" : null,
      note: null,
      softPenalty: 0,
      prior: 0,
    })
  }
  return out
}

/** The identity of a "Series: Title" catalog title under its own title. */
export function alsoKnownAs(work: {
  title: string
  authors: string[]
}): string[] {
  const colon = work.title.indexOf(":")
  if (colon < 0) return []
  const rest = work.title.slice(colon + 1).trim()
  return rest ? [workIdentity(rest, work.authors)] : []
}

export type FilterContext = {
  data: ReaderData
  profile: ReaderProfile
  avoidSubjects: string[]
  /** Weekly rounds also rest picks ignored twice. */
  restIgnored: boolean
}

/**
 * Drop what must never be shown: read, owned, requested, turned down,
 * resting, unreleased, not in a language the reader reads, by an author they
 * rate low, or in a subject they avoid. "Probably read" (an estimate) only
 * lowers the score and adds a note.
 */
export function filterCandidates(
  candidates: Candidate[],
  context: FilterContext,
): { kept: Candidate[]; ignoredTwice: string[] } {
  const { data, profile } = context
  const avoided = new Set(
    profile.avoidedAuthors.map((author) => authorKey(author.name)),
  )
  const avoidSubjects = context.avoidSubjects.map(normalizeText).filter(Boolean)
  const now = sqlTime()
  const kept: Candidate[] = []
  const ignoredTwice: string[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const { identity, work } = candidate
    // "The Lord of the Rings: The Fellowship of the Ring" is the same book
    // as "The Fellowship of the Ring": check both names.
    const names = [identity, ...alsoKnownAs(work)]
    if (names.some((name) => seen.has(name))) continue
    const book = names
      .map((name) => data.byIdentity.get(name))
      .find((each) => !!each)
    if (book && (isRead(book) || book.inLibrary)) continue
    if (names.some((name) => data.requested.has(name))) continue
    if (names.some((name) => data.notForMe.has(name))) continue
    const rested = data.restedUntil.get(identity)
    if (rested && rested > now) continue
    if (!isReleased(work) || !readableLanguage(work)) continue
    if (work.authors[0] && avoided.has(authorKey(work.authors[0]))) continue
    if (
      avoidSubjects.length &&
      work.subjects.some((subject) =>
        avoidSubjects.some((avoid) => normalizeText(subject).includes(avoid)),
      )
    ) {
      continue
    }
    if (context.restIgnored && data.ignoredTwice.has(identity)) {
      ignoredTwice.push(identity)
      continue
    }
    for (const name of names) seen.add(name)
    if (book && book.status === "probably_read") {
      kept.push({
        ...candidate,
        softPenalty: candidate.softPenalty + 15,
        note: "Might be read on Kindle",
      })
      continue
    }
    kept.push(candidate)
  }
  return { kept, ignoredTwice }
}
