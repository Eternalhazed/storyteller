import {
  audibleId,
  audibleSimilar,
  audibleWorksByAuthor,
  getAudibleSeries,
  getAudibleWorks,
  searchAudible,
} from "./audible"
import {
  canonicalAuthor,
  mainTitle,
  sameWork,
  titleWithoutSubtitle,
} from "./normalize"
import {
  findOpenLibraryByIsbn,
  getOpenLibraryWorks,
  openLibraryId,
  searchOpenLibrary,
} from "./openLibrary"
import type { Catalog } from "./types"

function splitKeys(keys: string[]) {
  const audible: string[] = []
  const openLibrary: string[] = []
  for (const key of keys) {
    const asin = audibleId(key)
    if (asin) audible.push(asin)
    else {
      const olid = openLibraryId(key)
      if (olid) openLibrary.push(olid)
    }
  }
  return { audible, openLibrary }
}

async function findTitle(
  search: Catalog["search"],
  query: { title: string; authors: string[] },
) {
  const title = titleWithoutSubtitle(query.title)
  if (!mainTitle(title)) return null
  const authors = new Set(query.authors.map(canonicalAuthor).filter(Boolean))
  for (const author of authors) {
    const candidates = await search({ title, author })
    const match = candidates.find((candidate) => sameWork(candidate, query))
    if (match) return match
  }
  return null
}

const catalog: Catalog = {
  async search(query) {
    const title = titleWithoutSubtitle(query.title)
    if (!mainTitle(title)) return []
    const author = query.author ? canonicalAuthor(query.author) : null
    const search = { ...query, title, author }
    const audio = await searchAudible(search)
    const matches = audio.some((work) =>
      author
        ? sameWork(work, { title, authors: [author] })
        : mainTitle(work.title) === mainTitle(title),
    )
    if (matches) return audio
    const ebooks = await searchOpenLibrary(search)
    return ebooks.length ? ebooks : audio
  },

  async getWorks(keys) {
    const { audible, openLibrary } = splitKeys(keys)
    const [audio, ebooks] = await Promise.all([
      getAudibleWorks(audible),
      getOpenLibraryWorks(openLibrary),
    ])
    for (const [key, work] of ebooks) audio.set(key, work)
    return audio
  },

  findByIsbn: findOpenLibraryByIsbn,

  getSeries(keys) {
    return getAudibleSeries(splitKeys(keys).audible)
  },

  worksByAuthor(author, limit) {
    return audibleWorksByAuthor(canonicalAuthor(author), limit)
  },

  similar(key, limit) {
    const asin = audibleId(key)
    return asin ? audibleSimilar(asin, limit) : Promise.resolve([])
  },

  async resolve(query) {
    if (query.asin) {
      const asin = audibleId(`audible:${query.asin.trim().toUpperCase()}`)
      if (asin) {
        const works = await getAudibleWorks([asin])
        const work = works.get(`audible:${asin}`)
        if (work) return { work, matchedBy: "asin" }
      }
    }

    const isbns = [query.isbn13, query.isbn10].filter(
      (isbn): isbn is string => !!isbn,
    )
    if (isbns.length) {
      const works = await findOpenLibraryByIsbn(isbns)
      for (const isbn of isbns) {
        const ebook = works.get(isbn)
        if (!ebook) continue
        return {
          work: (await findTitle(searchAudible, ebook)) ?? ebook,
          matchedBy: "isbn",
        }
      }
    }

    const name = { title: query.title, authors: query.authors ?? [] }
    const work =
      (await findTitle(searchAudible, name)) ??
      (await findTitle(searchOpenLibrary, name))
    return work ? { work, matchedBy: "title" } : null
  },
}

let override: Catalog | null = null

export function getCatalog(): Catalog {
  return override ?? catalog
}

export function setCatalogForTests(value: Catalog | null): void {
  override = value
}
