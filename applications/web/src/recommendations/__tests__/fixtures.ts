import { randomUUID } from "node:crypto"

import { type z } from "zod"

import { type StructuredCallOptions, type TokenUsage } from "@storyteller/xray"

import { type TestDbContext } from "@/__tests__/harness/testDb"
import { mainTitle, normalizeText, sameWork } from "@/catalog/normalize"
import {
  type Catalog,
  type CatalogSeries,
  type CatalogWork,
} from "@/catalog/types"
import { type UUID } from "@/uuid"

/** Made-up catalog entries shaped like the real ones. */
export function work(
  key: string,
  title: string,
  author: string,
  extra: Partial<CatalogWork> = {},
): CatalogWork {
  return {
    key,
    title,
    subtitle: null,
    authors: [author],
    narrators: ["A. Narrator"],
    series: [],
    releaseDate: "2010-01-01",
    language: "en",
    runtimeMinutes: 600,
    pages: null,
    abridged: false,
    subjects: ["Fiction"],
    description: `${title}, a novel.`,
    coverUrl: null,
    ids: { asin: key.split(":")[1] ?? key },
    ...extra,
  }
}

function seriesOf(
  key: string,
  name: string,
  author: string,
  titles: string[],
  subjects: string[],
  releases: string[] = [],
): { series: CatalogSeries; works: CatalogWork[] } {
  const works = titles.map((title, index) =>
    work(`audible:${key}${index + 1}`, title, author, {
      series: [{ key: `audible:${key}`, name, position: index + 1 }],
      releaseDate: releases[index] ?? `20${String(index + 10)}-01-01`,
      subjects,
    }),
  )
  return {
    works,
    series: {
      key: `audible:${key}`,
      name,
      authors: [author],
      books: works.map((each, index) => ({ position: index + 1, work: each })),
      latestReleaseDate: works.at(-1)?.releaseDate ?? null,
    },
  }
}

export function fakeUniverse() {
  const naval = ["Historical Fiction", "Naval"]
  const aubrey = seriesOf(
    "AM",
    "Aubrey/Maturin",
    "Patrick O'Brian",
    [
      "Master and Commander",
      "Post Captain",
      "HMS Surprise",
      "The Mauritius Command",
    ],
    naval,
  )
  const frontlines = seriesOf(
    "FL",
    "Frontlines",
    "Marko Kloos",
    ["Terms of Enlistment", "Lines of Departure", "Angles of Attack"],
    ["Military Science Fiction"],
  )
  const emperor = seriesOf(
    "EM",
    "Emperor",
    "Conn Iggulden",
    [
      "The Gates of Rome",
      "The Death of Kings",
      "The Field of Swords",
      "The Gods of War",
      "The Blood of Gods",
    ],
    ["Historical Fiction", "Rome"],
  )
  const palladium = seriesOf(
    "PW",
    "The Palladium Wars",
    "Marko Kloos",
    ["Aftershocks", "Ballistic", "Citadel", "Point of Impact"],
    ["Military Science Fiction"],
  )
  const trilogy = seriesOf(
    "ST",
    "The Short Watch",
    "Jane Harbor",
    ["First Watch", "Middle Watch", "Last Watch"],
    ["Naval"],
  )
  const longRun = seriesOf(
    "LR",
    "Long Run",
    "Sam Fleet",
    Array.from({ length: 12 }, (_, index) => `Long Run ${index + 1}`),
    ["Naval"],
  )
  const standalones = [
    work("audible:KM1", "Killer of Men", "Christian Cameron", {
      subjects: ["Historical Fiction", "Greece"],
    }),
    work("audible:SE1", "Sharpe's Eagle", "Bernard Cornwell", {
      subjects: ["Historical Fiction", "Napoleonic"],
    }),
    work("audible:GE1", "Gardening Basics", "Pat Green", {
      subjects: ["Gardening"],
    }),
    work("audible:FR1", "Le Livre", "Jean Auteur", { language: "fr" }),
    work("audible:FU1", "Future Book", "Pat Later", {
      releaseDate: "2999-01-01",
    }),
    work("audible:HB1", "The Hobbit", "J. R. R. Tolkien", {
      subjects: ["Fantasy"],
    }),
    work("audible:HB2", "The Hobbit", "Someone Else", {
      subjects: ["Children"],
    }),
    // A second edition of a book above, titled with its series in front.
    work("audible:KM2", "The Long War: Killer of Men", "Christian Cameron", {
      subjects: ["Historical Fiction", "Greece"],
    }),
  ]
  const series = [aubrey, frontlines, emperor, palladium, trilogy, longRun]
  const works = [...series.flatMap((each) => each.works), ...standalones]
  return {
    works,
    series: series.map((each) => each.series),
    aubrey,
    frontlines,
    emperor,
    palladium,
    trilogy,
  }
}

/** A catalog held in memory. Records every lookup. */
export class FakeCatalog implements Catalog {
  readonly works: Map<string, CatalogWork>
  readonly series: Map<string, CatalogSeries>
  similarTo = new Map<string, string[]>()
  lookups = 0

  constructor(universe = fakeUniverse()) {
    this.works = new Map(universe.works.map((each) => [each.key, each]))
    this.series = new Map(universe.series.map((each) => [each.key, each]))
  }

  search(query: { title: string; author?: string | null; limit?: number }) {
    this.lookups++
    const wanted = mainTitle(query.title)
    const series = normalizeText(query.title)
    return Promise.resolve(
      [...this.works.values()]
        .filter(
          (each) =>
            (mainTitle(each.title).includes(wanted) ||
              each.series.some((ref) =>
                normalizeText(ref.name).includes(series),
              )) &&
            (!query.author ||
              sameWork(each, { title: each.title, authors: [query.author] })),
        )
        .slice(0, query.limit ?? 10),
    )
  }
  getWorks(keys: string[]) {
    this.lookups++
    return Promise.resolve(
      new Map(
        keys.flatMap((key) =>
          this.works.has(key) ? [[key, this.works.get(key)!]] : [],
        ),
      ),
    )
  }
  findByIsbn() {
    return Promise.resolve(new Map<string, CatalogWork>())
  }
  getSeries(keys: string[]) {
    this.lookups++
    return Promise.resolve(
      new Map(
        keys.flatMap((key) =>
          this.series.has(key) ? [[key, this.series.get(key)!]] : [],
        ),
      ),
    )
  }
  worksByAuthor(author: string) {
    this.lookups++
    return Promise.resolve(
      [...this.works.values()].filter((each) =>
        sameWork(each, { title: each.title, authors: [author] }),
      ),
    )
  }
  similar(key: string) {
    this.lookups++
    return Promise.resolve(
      (this.similarTo.get(key) ?? []).flatMap(
        (each) => this.works.get(each) ?? [],
      ),
    )
  }
  resolve(query: { title: string; authors?: string[] }) {
    this.lookups++
    const found = [...this.works.values()].find((each) =>
      sameWork(each, { title: query.title, authors: query.authors ?? [] }),
    )
    return Promise.resolve(
      found ? { work: found, matchedBy: "title" as const } : null,
    )
  }
}

const USAGE: TokenUsage = {
  inputTokens: 1000,
  outputTokens: 200,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
}

/**
 * A stand-in for the model. Proposes the titles it is given, scores each
 * candidate from `fits` (default 70) citing its first evidence id, and
 * records every prompt.
 */
export class FakeModel {
  prompts: string[] = []
  proposals: {
    title: string
    author: string
    kind: "new" | "stretch" | "similar"
  }[] = []
  fits = new Map<string, number>()
  /** Set to make the scoring call cite an id that does not exist. */
  citeNothing = new Set<string>()
  ask: unknown = { intent: "unclear", books: [], wish: null }
  fail = false
  /** Answer ids the way the real model sometimes does: "c3: Title", "e1: fact". */
  verboseIds = false

  caller = <T extends z.ZodType>(options: StructuredCallOptions<T>) => {
    const text = `${options.system}\n${options.user}`
    this.prompts.push(text)
    if (this.fail) return Promise.reject(new Error("model down"))
    let output: unknown
    if (options.user.includes("Classify it")) {
      output = this.ask
    } else if (options.user.includes("Propose:")) {
      output = { proposals: this.proposals }
    } else {
      const block =
        /<data name="candidates">\n([\s\S]*?)\n<\/data>/.exec(
          options.user,
        )?.[1] ?? "[]"
      const candidates = JSON.parse(block) as {
        id: string
        title: string
        evidence: string[]
      }[]
      output = {
        picks: candidates.map((candidate) => ({
          candidate: this.verboseIds
            ? `${candidate.id}: ${candidate.title}`
            : candidate.id,
          fit: this.fits.get(candidate.title) ?? 70,
          reason: `Because of ${candidate.title}`,
          why: `Why ${candidate.title}.`,
          evidence: this.citeNothing.has(candidate.title)
            ? ["e999"]
            : [
                this.verboseIds
                  ? (candidate.evidence[0] ?? "e1: a fact")
                  : (candidate.evidence[0]?.split(":")[0] ?? "e1"),
              ],
        })),
      }
    }
    return Promise.resolve({ output: output as z.output<T>, usage: USAGE })
  }
}

export function seedReader(ctx: TestDbContext, name: string): UUID {
  const id = randomUUID()
  const permission = randomUUID()
  ctx.sqlite
    .prepare(
      `INSERT INTO user_permission (uuid, book_list, book_read) VALUES (?, 1, 1)`,
    )
    .run(permission)
  ctx.sqlite
    .prepare(
      `INSERT INTO "user" (id, user_permission_uuid, email, name) VALUES (?, ?, ?, ?)`,
    )
    .run(id, permission, `${name}@example.com`, name)
  return id
}

export function privateShelf(ctx: TestDbContext, userId: UUID): UUID {
  const shelf = randomUUID()
  ctx.sqlite
    .prepare(`INSERT INTO collection (uuid, name, public) VALUES (?, ?, 0)`)
    .run(shelf, `Shelf ${shelf.slice(0, 4)}`)
  ctx.sqlite
    .prepare(
      `INSERT INTO collection_to_user (user_id, collection_uuid) VALUES (?, ?)`,
    )
    .run(userId, shelf)
  return shelf
}

/** A library book with an author, on a shelf, optionally read and rated by a reader. */
export function seedLibraryBook(
  ctx: TestDbContext,
  options: {
    title: string
    author: string
    shelf: UUID
    series?: { name: string; position: number }
    reader?: UUID
    status?: "Read" | "Reading" | "To read"
    rating?: number
  },
): UUID {
  const book = randomUUID()
  ctx.sqlite
    .prepare(`INSERT INTO book (uuid, title, asset_dir) VALUES (?, ?, ?)`)
    .run(book, options.title, book)
  ctx.sqlite
    .prepare(
      `INSERT OR IGNORE INTO creator (uuid, name, file_as) VALUES (?, ?, ?)`,
    )
    .run(randomUUID(), options.author, options.author)
  const creator = (
    ctx.sqlite
      .prepare(`SELECT uuid FROM creator WHERE name = ?`)
      .get(options.author) as {
      uuid: string
    }
  ).uuid
  ctx.sqlite
    .prepare(
      `INSERT INTO book_to_creator (book_uuid, creator_uuid, role) VALUES (?, ?, 'aut')`,
    )
    .run(book, creator)
  ctx.sqlite
    .prepare(
      `INSERT INTO book_to_collection (book_uuid, collection_uuid) VALUES (?, ?)`,
    )
    .run(book, options.shelf)
  if (options.series) {
    let series = ctx.sqlite
      .prepare(`SELECT uuid FROM series WHERE name = ?`)
      .get(options.series.name) as { uuid: string } | undefined
    if (!series) {
      series = { uuid: randomUUID() }
      ctx.sqlite
        .prepare(`INSERT INTO series (uuid, name) VALUES (?, ?)`)
        .run(series.uuid, options.series.name)
    }
    ctx.sqlite
      .prepare(
        `INSERT INTO book_to_series (series_uuid, book_uuid, position) VALUES (?, ?, ?)`,
      )
      .run(series.uuid, book, options.series.position)
  }
  if (options.reader && options.status) {
    const status = ctx.sqlite
      .prepare(`SELECT uuid FROM status WHERE name = ?`)
      .get(options.status) as { uuid: string }
    ctx.sqlite
      .prepare(
        `INSERT INTO book_to_status (book_uuid, status_uuid, user_id) VALUES (?, ?, ?)`,
      )
      .run(book, status.uuid, options.reader)
  }
  if (options.reader && options.rating != null) {
    ctx.sqlite
      .prepare(
        `INSERT INTO user_book_rating (user_id, book_uuid, rating) VALUES (?, ?, ?)`,
      )
      .run(options.reader, book, options.rating)
  }
  return book
}

export function statusUuid(ctx: TestDbContext, name: string): UUID {
  return (
    ctx.sqlite.prepare(`SELECT uuid FROM status WHERE name = ?`).get(name) as {
      uuid: UUID
    }
  ).uuid
}
