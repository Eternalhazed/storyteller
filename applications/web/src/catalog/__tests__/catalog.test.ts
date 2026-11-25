import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setupTestDb, type TestDbContext } from "@/__tests__/harness/testDb"
import { getCatalog, setCatalogForTests } from "@/catalog"

import products from "./fixtures/audible-products.json"
import relationships from "./fixtures/audible-series.json"
import ebooks from "./fixtures/open-library.json"

const postCaptain = products.products.find(({ asin }) => asin === "B002UZI17C")!
const [secretSocietyGirl] = ebooks.docs
const seriesKey = "audible:B005NBOMVO"
const productGroups =
  "contributors,series,product_desc,product_attrs,media,category_ladders"
const day = 86_400_000

const fetch = vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>()
let db: TestDbContext | undefined

beforeEach(() => {
  db = setupTestDb()
  fetch.mockReset()
  vi.stubGlobal("fetch", fetch)
})

afterEach(() => {
  setCatalogForTests(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  db?.[Symbol.dispose]()
  db = undefined
})

function mockCatalog(handler: (url: URL) => unknown) {
  fetch.mockImplementation((url) =>
    Promise.resolve(Response.json(handler(url))),
  )
}

describe("Audible catalog", () => {
  it("maps a recorded product and requests the specified response groups", async () => {
    mockCatalog(() => ({ products: [postCaptain, { asin: "0000000000" }] }))
    const works = await getCatalog().getWorks([
      "audible:B002UZI17C",
      "audible:0000000000",
    ])
    expect(works.size).toBe(1)
    expect(works.get("audible:B002UZI17C")).toEqual({
      key: "audible:B002UZI17C",
      title: "Post Captain",
      subtitle: "Aubrey/Maturin Series, Book 2",
      authors: ["Patrick O'Brian"],
      narrators: ["Patrick Tull"],
      series: [{ key: seriesKey, name: "Aubrey/Maturin", position: 2 }],
      releaseDate: "2004-01-07",
      language: "en",
      runtimeMinutes: 1163,
      pages: null,
      abridged: false,
      subjects: [
        "Literature & Fiction",
        "Action & Adventure",
        "Genre Fiction",
        "Historical Fiction",
        "Literary Fiction",
      ],
      description: postCaptain.merchandising_summary,
      coverUrl: "https://m.media-amazon.com/images/I/51sJUdc4AWL._SL500_.jpg",
      ids: { asin: "B002UZI17C" },
    })
    expect(fetch.mock.calls[0]?.[0].searchParams.get("response_groups")).toBe(
      productGroups,
    )
  })

  it("limits batch lookups to 50 ASINs and caches results per ASIN", async () => {
    mockCatalog((url) => ({
      products: url.searchParams
        .get("asins")
        ?.split(",")
        .map((asin) => ({ ...postCaptain, asin })),
    }))
    const keys = Array.from(
      { length: 53 },
      (_, i) => `audible:${String(i).padStart(10, "0")}`,
    )
    expect((await getCatalog().getWorks(keys)).size).toBe(53)
    expect(
      fetch.mock.calls.map(
        ([url]) => url.searchParams.get("asins")?.split(",").length,
      ),
    ).toEqual([50, 3])
    expect((await getCatalog().getWorks(keys.slice(48))).size).toBe(5)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("selects one main book per position and retains genuine unreleased books", async () => {
    const extra = [
      { sequence: "2.1", title: "A novella" },
      { sequence: "1-2", title: "An omnibus" },
      {
        sequence: "2",
        subtitle: "A BBC Radio Dramatisation",
        release_date: "1998-01-01",
      },
      { sequence: "2", format_type: "abridged", release_date: "1997-01-01" },
      { sequence: "3", language: "french", title: "Une traduction" },
      {
        sequence: "4",
        title: "A forthcoming book",
        release_date: "2099-02-12",
      },
    ].map(({ sequence, ...edition }, i) => ({
      ...postCaptain,
      ...edition,
      asin: `BOOK00000${i}`,
      series: [{ asin: "B005NBOMVO", title: "Aubrey/Maturin", sequence }],
    }))
    mockCatalog((url) => {
      if (url.pathname.endsWith("/B005NBOMVO")) {
        return {
          product: {
            ...relationships.product,
            relationships: [
              ...relationships.product.relationships,
              ...extra.map(({ asin, series }) => ({
                asin,
                relationship_to_product: "child",
                relationship_type: "series",
                sequence: series[0]?.sequence,
              })),
            ],
          },
        }
      }
      const asins = new Set(url.searchParams.get("asins")?.split(","))
      return {
        products: [...products.products, ...extra].filter(({ asin }) =>
          asins.has(asin),
        ),
      }
    })
    const series = (await getCatalog().getSeries([seriesKey])).get(seriesKey)
    expect(series).toMatchObject({
      key: seriesKey,
      name: "Aubrey/Maturin",
      authors: ["Patrick O'Brian"],
      latestReleaseDate: "2099-02-12",
    })
    expect(
      series?.books.map(({ work, position }) => [position, work.key]),
    ).toEqual([
      [1, "audible:B002V0KS9A"],
      [2, "audible:B002UZI17C"],
      [4, "audible:BOOK000005"],
    ])
    const batch = fetch.mock.calls[1]?.[0].searchParams.get("asins")?.split(",")
    expect(batch).not.toContain("BOOK000000")
    expect(batch).not.toContain("BOOK000001")
    expect((await getCatalog().getSeries([seriesKey])).get(seriesKey)).toEqual(
      series,
    )
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("filters preorders, series, podcasts and false author matches", async () => {
    const candidates = [
      postCaptain,
      { ...postCaptain, asin: "B0H6H25JN1", release_date: "2099-12-08" },
      {
        ...postCaptain,
        asin: "B005NBOMVO",
        content_delivery_type: "BookSeries",
      },
      {
        ...postCaptain,
        asin: "B0GFG5YY65",
        content_delivery_type: "PodcastParent",
      },
      { ...postCaptain, asin: "B002V0KS9A", release_date: "2008-01-02" },
      {
        ...postCaptain,
        asin: "B002V5GT0C",
        authors: [{ name: "John O'Brian" }],
      },
    ]
    mockCatalog((url) =>
      url.pathname.endsWith("/sims")
        ? { similar_products: candidates }
        : { products: candidates },
    )
    const author = await getCatalog().worksByAuthor("O'Brian, Patrick")
    expect(author.map(({ key }) => key)).toEqual([
      "audible:B002V0KS9A",
      "audible:B002UZI17C",
    ])
    expect(fetch.mock.calls[0]?.[0].searchParams.get("products_sort_by")).toBe(
      "-ReleaseDate",
    )
    expect(fetch.mock.calls[0]?.[0].searchParams.get("author")).toBe(
      "Patrick O'Brian",
    )
    expect(fetch.mock.calls[0]?.[0].searchParams.get("page")).toBe("0")
    const similar = await getCatalog().similar("audible:B002UZI17C")
    expect(similar.map(({ key }) => key)).toEqual([
      "audible:B002V0KS9A",
      "audible:B002V5GT0C",
    ])
  })
})

describe("composite catalog", () => {
  it("batches ISBNs and resolves an Open Library work by its stable key", async () => {
    mockCatalog(() => ebooks)
    const isbns = [
      "9780385340021",
      "0-385-34002-8",
      "9780440243892",
      "9781234567897",
    ]
    const works = await getCatalog().findByIsbn(isbns)
    expect(works.size).toBe(3)
    expect(works.get("9780385340021")).toMatchObject({
      key: "ol:OL8052018W",
      title: "Secret Society Girl",
      authors: ["Diana Peterfreund"],
      language: "en",
      pages: 312,
      coverUrl: "https://covers.openlibrary.org/b/id/240281-L.jpg",
      ids: { olid: "OL8052018W", isbn13: "9780385340021" },
      subjects: secretSocietyGirl?.subject,
    })
    expect(fetch.mock.calls[0]?.[0].searchParams.get("q")).toContain(
      "isbn:9780385340021 OR isbn:0385340028",
    )
    expect(fetch.mock.calls[0]?.[1]?.headers).toHaveProperty(
      "User-Agent",
      expect.stringContaining("Storyteller"),
    )
    expect(await getCatalog().findByIsbn(isbns)).toEqual(works)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(
      (await getCatalog().getWorks(["ol:OL8052018W"])).has("ol:OL8052018W"),
    ).toBe(true)
    expect(fetch.mock.calls[1]?.[0].searchParams.get("q")).toBe(
      'key:("/works/OL8052018W")',
    )
  })

  it("honors ASINs and otherwise matches normalized title plus any agreeing author", async () => {
    mockCatalog(() => products)
    expect(
      await getCatalog().resolve({ title: "Post Captain", asin: "b002uzi17c" }),
    ).toMatchObject({
      matchedBy: "asin",
      work: { key: "audible:B002UZI17C" },
    })
    expect(
      await getCatalog().resolve({
        title: "Post Captain (Aubrey/Maturin, #2)",
        authors: ["Other Author", "O'Brian, Patrick"],
      }),
    ).toMatchObject({ matchedBy: "title", work: { key: "audible:B002UZI17C" } })
    expect(fetch.mock.calls[1]?.[0].searchParams.get("title")).toBe(
      "Post Captain",
    )
    expect(await getCatalog().resolve({ title: "Post Captain" })).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("falls back to Open Library only accepting a matching title and author", async () => {
    const sameTitleWrongAuthor = {
      ...postCaptain,
      title: "Secret Society Girl",
    }
    mockCatalog((url) =>
      url.hostname === "api.audible.com"
        ? { products: [sameTitleWrongAuthor] }
        : ebooks,
    )
    const query = {
      title: "Secret Society Girl",
      authors: ["Diana Peterfreund"],
    }
    expect(await getCatalog().resolve(query)).toMatchObject({
      matchedBy: "title",
      work: { key: "ol:OL8052018W" },
    })
    expect(
      await getCatalog().resolve({
        ...query,
        authors: ["Another Peterfreund"],
      }),
    ).toBeNull()
    expect(
      await getCatalog().resolve({ ...query, title: "A Nonexistent Title" }),
    ).toBeNull()
    expect(
      (
        await getCatalog().search({
          title: query.title,
          author: query.authors[0],
        })
      )[0]?.key,
    ).toBe("ol:OL8052018W")
  })

  it("prefers a verified Audible edition of the ISBN work and not a same-title lookalike", async () => {
    const wrongAuthor = { ...postCaptain, title: "Secret Society Girl" }
    const match = {
      ...wrongAuthor,
      asin: "0000000001",
      authors: [{ name: "Diana Peterfreund" }],
    }
    mockCatalog((url) =>
      url.hostname === "openlibrary.org"
        ? ebooks
        : { products: [wrongAuthor, match] },
    )
    expect(
      await getCatalog().resolve({
        title: "Untrusted import title",
        isbn13: "9780385340021",
      }),
    ).toMatchObject({
      matchedBy: "isbn",
      work: { key: "audible:0000000001" },
    })
    expect(fetch.mock.calls[1]?.[0].searchParams.get("title")).toBe(
      "Secret Society Girl",
    )
  })

  it("keeps the Open Library record when the ISBN has no verified Audible edition", async () => {
    mockCatalog((url) =>
      url.hostname === "openlibrary.org" ? ebooks : { products: [postCaptain] },
    )
    expect(
      await getCatalog().resolve({
        title: "Secret Society Girl",
        isbn10: "0385340028",
      }),
    ).toMatchObject({
      matchedBy: "isbn",
      work: { key: "ol:OL8052018W" },
    })
  })
})

it("expires negative entries after one day and product hits after 30 days", async () => {
  const now = Date.now()
  const clock = vi.spyOn(Date, "now").mockReturnValue(now)
  mockCatalog(() => ({ products: [postCaptain, { asin: "0000000000" }] }))
  const keys = ["audible:B002UZI17C", "audible:0000000000"]
  expect((await getCatalog().getWorks(keys)).size).toBe(1)
  clock.mockReturnValue(now + day - 1)
  expect((await getCatalog().getWorks(keys)).size).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(1)
  clock.mockReturnValue(now + day)
  expect((await getCatalog().getWorks(keys)).size).toBe(1)
  expect(fetch.mock.calls[1]?.[0].searchParams.get("asins")).toBe("0000000000")
  clock.mockReturnValue(now + 30 * day)
  expect((await getCatalog().getWorks(keys)).size).toBe(1)
  expect(fetch.mock.calls[2]?.[0].searchParams.get("asins")).toBe(
    "B002UZI17C,0000000000",
  )
})
