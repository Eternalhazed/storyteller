import { getCatalog } from "@/catalog"
import { mainTitle, normalizeText, workIdentity } from "@/catalog/normalize"
import { type CatalogSeries, type CatalogWork } from "@/catalog/types"
import { getBooks } from "@/database/books"
import { getReader, preferencesOf } from "@/database/recommendations"
import { findLibraryCopies, findWorkInLibrary } from "@/requests/library"
import { type UUID } from "@/uuid"

import { type AiConfig } from "./ai"
import { entryPoint, isReleased, readableLanguage } from "./candidates"
import { type AskParse, parseAsk } from "./model"
import { loadReaderData } from "./reader"
import { startRound, toPickWork } from "./rounds"
import { clearFinishWindow } from "./triggers"
import {
  type AskCard,
  type AskQuestion,
  type AskResult,
  type PickSeries,
} from "./types"
import { toRoundView } from "./views"

const UNCLEAR =
  'Try a title ("The Gates of Rome"), a book you finished ("I just finished Post Captain") or what you are in the mood for ("something like Sharpe but at sea").'

/** What the reader already has of a book, without saying whose copy it is. */
async function card(
  userId: UUID,
  work: CatalogWork,
  series: PickSeries | null,
): Promise<AskCard> {
  const pickWork = toPickWork(work)
  const { mine, elsewhere } = await findLibraryCopies(pickWork, userId)
  const own = mine[0]
  if (own) {
    const [book] = await getBooks([own.bookUuid], userId)
    const toRead = book?.status?.name.toLowerCase() === "to read"
    return {
      work: pickWork,
      series,
      state: toRead ? "to_read" : "on_shelf",
      bookUuid: own.bookUuid,
    }
  }
  const household = elsewhere[0]
  return {
    work: pickWork,
    series,
    state: household ? "household" : "get",
    bookUuid: household?.bookUuid ?? null,
  }
}

function usable(work: CatalogWork): boolean {
  return isReleased(work) && readableLanguage(work)
}

/** One distinct work per identity, in the catalog's order. */
function distinct(works: CatalogWork[]): CatalogWork[] {
  const seen = new Set<string>()
  return works.filter((work) => {
    const identity = workIdentity(work.title, work.authors)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

type Found =
  | { kind: "card"; work: CatalogWork; series: PickSeries | null }
  | { kind: "question"; asked: string; works: CatalogWork[] }
  | { kind: "missing"; asked: string }

function toPickSeries(series: CatalogSeries, position: number): PickSeries {
  return {
    name: series.name,
    position,
    books: series.books.length,
    latestReleaseYear: series.latestReleaseDate
      ? Number(series.latestReleaseDate.slice(0, 4))
      : null,
  }
}

/** Where a work sits in its main series, when the catalog lists one. */
async function seriesOf(work: CatalogWork): Promise<PickSeries | null> {
  const ref = work.series[0]
  if (!ref) return null
  const series = (await getCatalog().getSeries([ref.key])).get(ref.key)
  const entry = series?.books.find((book) => book.work.key === work.key)
  return series && entry ? toPickSeries(series, entry.position) : null
}

function sameSeriesName(a: string, b: string): boolean {
  const x = normalizeText(a)
  const y = normalizeText(b)
  return x.includes(y) || y.includes(x)
}

/**
 * A book of a named series: the numbered one ("Expanse #4"), or with no
 * number the next one this reader has not read ("the next Expanse book").
 */
async function seriesBook(
  userId: UUID,
  series: string,
  number: number | null,
  author: string | null,
): Promise<Found> {
  const catalog = getCatalog()
  const asked =
    number == null ? `the next ${series} book` : `${series} #${number}`
  const hits = [
    ...(await catalog.search({ title: series, author, limit: 10 })),
    ...(author ? await catalog.worksByAuthor(author, 50) : []),
  ]
  // "Frontlines" is the series of that name, not "Frontlines: Evolution".
  const pick = (refs: CatalogWork["series"]) =>
    refs.find((each) => normalizeText(each.name) === normalizeText(series)) ??
    refs.find((each) => sameSeriesName(each.name, series))
  let ref = pick(hits.flatMap((work) => work.series))
  // Ebook-only matches carry no series: look a few of them up again.
  for (const hit of hits.filter((work) => !work.series.length).slice(0, 3)) {
    if (ref) break
    const resolved = await catalog.resolve({
      title: hit.title,
      authors: hit.authors,
    })
    ref = pick(resolved?.work.series ?? [])
  }
  if (!ref) return { kind: "missing", asked }
  const found = (await catalog.getSeries([ref.key])).get(ref.key)
  if (!found) return { kind: "missing", asked }
  const entry =
    number == null
      ? entryPoint(
          found,
          await loadReaderData(userId, preferencesOf(await getReader(userId))),
        )
      : (found.books.find((book) => book.position === number) ?? null)
  if (!entry || !usable(entry.work)) return { kind: "missing", asked }
  return {
    kind: "card",
    work: entry.work,
    series: toPickSeries(found, entry.position),
  }
}

/**
 * The book a typed title names. With an author, the catalog must agree on
 * both. Without one, a single work by that title is the answer; several
 * works by different authors become a question; nothing close is "not
 * found", never a guess.
 */
async function titleBook(book: AskParse["books"][number]): Promise<Found> {
  const catalog = getCatalog()
  const asked = book.author ? `${book.title} by ${book.author}` : book.title
  if (book.author) {
    const resolved = await catalog.resolve({
      title: book.title,
      authors: [book.author],
    })
    if (resolved && usable(resolved.work)) {
      return { kind: "card", work: resolved.work, series: null }
    }
  }
  const hits = distinct(
    (
      await catalog.search({ title: book.title, author: book.author, limit: 8 })
    ).filter(usable),
  )
  if (!hits.length) return { kind: "missing", asked }
  const wanted = mainTitle(book.title)
  const exact = hits.filter((work) => mainTitle(work.title) === wanted)
  const [only] = exact
  if (exact.length === 1 && only) {
    return { kind: "card", work: only, series: null }
  }
  if (exact.length > 1) {
    return { kind: "question", asked, works: exact.slice(0, 4) }
  }
  const close = hits.filter(
    (work) =>
      mainTitle(work.title).includes(wanted) ||
      wanted.includes(mainTitle(work.title)),
  )
  const [closest] = close
  if (close.length === 1 && closest) {
    return { kind: "card", work: closest, series: null }
  }
  if (close.length > 1) {
    return { kind: "question", asked, works: close.slice(0, 4) }
  }
  return { kind: "missing", asked }
}

/** The author of a series the reader has read, when they did not name one. */
async function readerSeriesAuthor(
  userId: UUID,
  series: string,
): Promise<string | null> {
  const data = await loadReaderData(
    userId,
    preferencesOf(await getReader(userId)),
  )
  const book = data.books.find(
    (each) => each.series && sameSeriesName(each.series.name, series),
  )
  return book?.authors[0] ?? null
}

/**
 * A named book: by its series position when the reader named a series
 * ("Expanse #4", "the next Expanse book"), otherwise by its title, with the
 * series as a fallback when the title does not resolve.
 */
async function findBook(
  userId: UUID,
  book: AskParse["books"][number],
): Promise<Found> {
  const series = book.series
  // A typed series position is what the reader asked for; a title the
  // model filled in for it may be wrong, so the position comes first.
  const seriesNamed =
    !!series &&
    (book.number != null ||
      normalizeText(book.title).includes(normalizeText(series)) ||
      !book.title.trim())
  const author = async () =>
    book.author ?? (series ? await readerSeriesAuthor(userId, series) : null)
  if (series && seriesNamed) {
    return await seriesBook(userId, series, book.number, await author())
  }
  const byTitle = await titleBook(book)
  if (byTitle.kind === "card") {
    return { ...byTitle, series: await seriesOf(byTitle.work) }
  }
  if (series && book.number != null) {
    const found = await seriesBook(userId, series, book.number, await author())
    if (found.kind !== "missing") return found
  }
  return byTitle
}

/** The finished book the reader named, if it is in their library. */
async function libraryBook(
  userId: UUID,
  book: AskParse["books"][number],
): Promise<{ bookUuid: UUID; title: string; read: boolean } | null> {
  const [match] = await findWorkInLibrary(
    { title: book.title, authors: book.author ? [book.author] : [] },
    userId,
  )
  if (!match) return null
  return {
    bookUuid: match.uuid,
    title: match.title,
    read: match.status?.name.toLowerCase() === "read",
  }
}

/** Answer what the reader typed. Nothing is requested from here. */
export async function ask(
  userId: UUID,
  ai: AiConfig,
  text: string,
): Promise<AskResult> {
  const { parse } = await parseAsk(ai, text.slice(0, 1000))

  if (parse.intent === "get" && parse.books.length) {
    const cards: AskCard[] = []
    const questions: AskQuestion[] = []
    const notFound: string[] = []
    for (const book of parse.books.slice(0, 10)) {
      const found = await findBook(userId, book)
      if (found.kind === "card") {
        cards.push(await card(userId, found.work, found.series))
      } else if (found.kind === "question") {
        questions.push({
          asked: found.asked,
          choices: await Promise.all(
            found.works.map((work) => card(userId, work, null)),
          ),
        })
      } else {
        notFound.push(found.asked)
      }
    }
    return { intent: "get", cards, questions, notFound }
  }

  if (parse.intent === "next" && parse.books[0]) {
    const book = parse.books[0]
    const mine = await libraryBook(userId, book)
    if (mine) {
      await clearFinishWindow(userId).catch(() => undefined)
      const round = await startRound(userId, "finished", {
        anchorBookUuid: mine.bookUuid,
      })
      return { intent: "next", round: toRoundView(round), anchor: mine }
    }
    const round = await startRound(userId, "wish", {
      wish: `What to read after finishing ${book.title}${book.author ? ` by ${book.author}` : ""}`,
    })
    return {
      intent: "next",
      round: toRoundView(round),
      anchor: { bookUuid: null, title: book.title, read: true },
    }
  }

  if (parse.intent === "wish" && (parse.wish || text.trim())) {
    const round = await startRound(userId, "wish", {
      wish: parse.wish ?? text.trim(),
    })
    return { intent: "wish", round: toRoundView(round) }
  }

  return { intent: "unclear", message: UNCLEAR }
}
