import { cacheTtl, cachedList, cachedMany } from "./cache"
import { requestCatalog } from "./limiter"
import { authorKey, mainTitle } from "./normalize"
import type { Catalog, CatalogSeries, CatalogWork } from "./types"

const BASE_URL = "https://api.audible.com/1.0/catalog/products"
const PRODUCT_GROUPS =
  "contributors,series,product_desc,product_attrs,media,category_ladders"
const PAGE_SIZE = 50

const languageTags: Record<string, string> = {
  arabic: "ar",
  chinese: "zh",
  czech: "cs",
  danish: "da",
  dutch: "nl",
  english: "en",
  finnish: "fi",
  french: "fr",
  german: "de",
  greek: "el",
  hebrew: "he",
  hindi: "hi",
  hungarian: "hu",
  italian: "it",
  japanese: "ja",
  korean: "ko",
  mandarin: "cmn",
  norwegian: "no",
  polish: "pl",
  portuguese: "pt",
  romanian: "ro",
  russian: "ru",
  spanish: "es",
  swedish: "sv",
  tamil: "ta",
  turkish: "tr",
  ukrainian: "uk",
}

type AudibleSeriesRef = { asin: string; title: string; sequence?: string }
type AudibleRelationship = {
  asin: string
  relationship_to_product: string
  relationship_type: string
  sequence?: string
}

type AudibleProduct = {
  asin: string
  title?: string
  subtitle?: string
  authors?: { name: string }[]
  narrators?: { name: string }[]
  series?: AudibleSeriesRef[]
  relationships?: AudibleRelationship[]
  language?: string
  content_type?: string
  content_delivery_type?: string
  format_type?: string
  runtime_length_min?: number
  release_date?: string
  product_images?: { "500"?: string }
  category_ladders?: { ladder?: { name: string }[] }[]
  merchandising_summary?: string
  publisher_summary?: string
  isbn13?: string
}

type AudibleResults = { products?: AudibleProduct[]; total_results?: number }
type AudibleEdition = {
  work: CatalogWork
  dramatized: boolean
  /** The catalog's own title needed no cleaning (usually the US edition). */
  tidy: boolean
}

const EDITION_SUFFIX =
  /\s*\((?:unabridged|abridged|dramati[sz]ed adaptation)\)\s*$/i

/**
 * The book's own title, without edition notes some regions add:
 * "EMPEROR: The Gates of Rome, Book 1 (Unabridged)" → "The Gates of Rome".
 */
export function cleanTitle(title: string, seriesNames: string[]): string {
  let clean = title.replace(EDITION_SUFFIX, "").trim()
  const prefixed = /^(.+?):\s+(.+?),\s+Book\s+\d+(?:\.\d+)?$/i.exec(clean)
  const prefix = prefixed?.[1]
  if (
    prefix &&
    prefixed[2] &&
    seriesNames.some((name) => name.toLowerCase() === prefix.toLowerCase())
  ) {
    clean = prefixed[2]
  } else if (seriesNames.length) {
    clean = clean.replace(/,\s+Book\s+\d+(?:\.\d+)?$/i, "")
  }
  return clean || title
}

/** Catalog descriptions arrive as HTML. */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

async function audible<T>(params: Record<string, string>, path = "") {
  const url = new URL(BASE_URL + path)
  url.search = new URLSearchParams(params).toString()
  return requestCatalog<T>(url)
}

export function audibleId(key: string): string | null {
  return /^audible:([A-Z0-9]{10})$/.exec(key)?.[1] ?? null
}

function sequence(value: string | undefined): number | null {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return null
  const position = Number(value)
  return Number.isFinite(position) ? position : null
}

function mapProduct(product: AudibleProduct): AudibleEdition | null {
  const rawTitle = product.title?.trim()
  if (!rawTitle || !product.asin) return null // Missing ASINs are returned without metadata.
  const title = cleanTitle(
    rawTitle,
    (product.series ?? []).flatMap((series) => series.title || []),
  )
  const delivery = product.content_delivery_type?.toLowerCase()
  if (
    delivery === "bookseries" ||
    delivery?.startsWith("podcast") ||
    product.content_type?.toLowerCase() === "bookseries" ||
    product.content_type?.toLowerCase() === "podcastparent"
  )
    return null

  const format = product.format_type?.toLowerCase()
  const language = product.language?.toLowerCase()
  const subtitle = product.subtitle?.trim() || null
  const releaseDate = product.release_date
  // A subject can appear in multiple ladders, sometimes at different depths.
  const subjects = new Map<string, number>()
  for (const { ladder } of product.category_ladders ?? []) {
    for (const [depth, { name }] of (ladder ?? []).entries()) {
      if (name) subjects.set(name, Math.max(depth, subjects.get(name) ?? 0))
    }
  }
  const narrators =
    product.narrators?.map(({ name }) => name).filter(Boolean) ?? []

  return {
    work: {
      key: `audible:${product.asin}`,
      title,
      subtitle,
      authors: product.authors?.map(({ name }) => name).filter(Boolean) ?? [],
      narrators,
      series: (product.series ?? []).flatMap((series) =>
        series.asin && series.title
          ? [
            {
              key: `audible:${series.asin}`,
              name: series.title,
              position: sequence(series.sequence),
            },
          ]
          : [],
      ),
      releaseDate:
        releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)
          ? releaseDate
          : null,
      language: language
        ? (languageTags[language] ??
          (/^[a-z]{2}$/.test(language) ? language : null))
        : null,
      runtimeMinutes: product.runtime_length_min ?? null,
      pages: null,
      abridged:
        format === "abridged" ? true : format === "unabridged" ? false : null,
      subjects: [...subjects].sort((a, b) => a[1] - b[1]).map(([name]) => name),
      description: (() => {
        const html =
          product.merchandising_summary || product.publisher_summary || null
        return html ? plainText(html) || null : null
      })(),
      coverUrl: product.product_images?.["500"] ?? null,
      ids: {
        asin: product.asin,
        ...(product.isbn13 && { isbn13: product.isbn13 }),
      },
    },
    dramatized:
      /\b(?:dramati[sz](?:ation|ed)|(?:full|ensemble)[ -]cast)\b/i.test(
        [rawTitle, subtitle, format, ...narrators].join(" "),
      ),
    tidy: title === rawTitle,
  }
}

async function getEditions(
  ids: string[],
): Promise<Map<string, AudibleEdition>> {
  return cachedMany(ids, "audible:product:", cacheTtl.work, async (missing) => {
    const editions = new Map<string, AudibleEdition>()
    for (let offset = 0; offset < missing.length; offset += PAGE_SIZE) {
      const batch = missing.slice(offset, offset + PAGE_SIZE)
      const response = await audible<AudibleResults>({
        asins: batch.join(","),
        response_groups: PRODUCT_GROUPS,
      })
      for (const product of response?.products ?? []) {
        const edition = mapProduct(product)
        if (edition) editions.set(product.asin, edition)
      }
    }
    return editions
  })
}

export const searchAudible: Catalog["search"] = async ({
  title,
  author,
  limit = 10,
}) => {
  if (!title || limit < 1) return []
  return cachedList(
    JSON.stringify([title, author ?? null, limit]),
    "audible:search:",
    cacheTtl.search,
    async () => {
      const response = await audible<AudibleResults>({
        title,
        ...(author && { author }),
        num_results: String(Math.min(PAGE_SIZE, limit)),
        response_groups: PRODUCT_GROUPS,
      })
      return (response?.products ?? [])
        .flatMap((product) => {
          const edition = mapProduct(product)
          return edition ? [edition.work] : []
        })
        .slice(0, limit)
    },
  )
}

export async function getAudibleWorks(
  ids: string[],
): Promise<Map<string, CatalogWork>> {
  const editions = await getEditions(ids)
  return new Map([...editions.values()].map(({ work }) => [work.key, work]))
}

function editionScore({ work, dramatized, tidy }: AudibleEdition): number {
  return (
    Number(work.language === "en") * 8 +
    Number(work.abridged === false) * 4 +
    Number(!dramatized) * 2 +
    Number(tidy)
  )
}

export async function getAudibleSeries(
  ids: string[],
): Promise<Map<string, CatalogSeries>> {
  const series = await cachedMany(
    ids,
    "audible:series:",
    cacheTtl.series,
    async (missing) => {
      const parents = await Promise.all(
        missing.map(async (asin) => {
          const response = await audible<{ product?: AudibleProduct }>(
            { response_groups: "relationships,product_desc" },
            `/${asin}`,
          )
          const product = response?.product
          if (!product?.title) return []
          const children = product.relationships?.filter(
            (relationship) =>
              relationship.relationship_to_product === "child" &&
              relationship.relationship_type === "series",
          )
          if (!children?.length) return []
          const entries = children.flatMap((child) => {
            const position = sequence(child.sequence)
            return position !== null && Number.isSafeInteger(position)
              ? [{ asin: child.asin, position }]
              : []
          })
          return [{ asin, name: product.title, entries }]
        }),
      )
      const groups = parents.flat()
      const editions = await getEditions(
        groups.flatMap(({ entries }) => entries.map(({ asin }) => asin)),
      )
      const found = new Map<string, CatalogSeries>()
      for (const { asin, name, entries } of groups) {
        const byPosition = new Map<number, AudibleEdition[]>()
        for (const child of entries) {
          const edition = editions.get(child.asin)
          if (
            !edition ||
            (edition.work.language && edition.work.language !== "en")
          )
            continue
          const choices = byPosition.get(child.position)
          if (choices) choices.push(edition)
          else byPosition.set(child.position, [edition])
        }
        const books = [...byPosition]
          .sort((a, b) => a[0] - b[0])
          .flatMap(([position, choices]) => {
            // Audible also numbers unfinished manuscripts. Exclude those titles and
            // editions at the same position whose metadata omits the subtitle.
            const unfinished = new Set(
              choices
                .filter(({ work }) =>
                  /\bunfinished (?:novel|manuscript|voyage)\b/i.test(
                    `${work.title} ${work.subtitle ?? ""}`,
                  ),
                )
                .map(({ work }) => mainTitle(work.title)),
            )
            const best = choices
              .filter(({ work }) => !unfinished.has(mainTitle(work.title)))
              .sort(
                (a, b) =>
                  editionScore(b) - editionScore(a) ||
                  (a.work.releaseDate ?? "9999-12-31").localeCompare(
                    b.work.releaseDate ?? "9999-12-31",
                  ) ||
                  a.work.key.localeCompare(b.work.key),
              )[0]
            return best ? [{ position, work: best.work }] : []
          })
        const authors = new Set<string>()
        let latestReleaseDate: string | null = null
        for (const { work } of books) {
          for (const author of work.authors) authors.add(author)
          if (
            work.releaseDate &&
            (!latestReleaseDate || work.releaseDate > latestReleaseDate)
          ) {
            latestReleaseDate = work.releaseDate
          }
        }
        const key = `audible:${asin}`
        found.set(asin, {
          key,
          name,
          authors: [...authors],
          books,
          latestReleaseDate,
        })
      }
      return found
    },
  )
  return new Map([...series.values()].map((entry) => [entry.key, entry]))
}

export const audibleWorksByAuthor: Catalog["worksByAuthor"] = async (
  author,
  limit = 20,
) => {
  const identity = authorKey(author)
  if (!identity || limit < 1) return []
  return cachedList(
    JSON.stringify([author, limit]),
    "audible:author:",
    cacheTtl.author,
    async () => {
      const today = new Date().toISOString().slice(0, 10)
      const works = new Map<string, CatalogWork>()
      for (let page = 0; works.size < limit; page++) {
        const response = await audible<AudibleResults>({
          author,
          products_sort_by: "-ReleaseDate",
          num_results: String(PAGE_SIZE),
          page: String(page),
          response_groups: PRODUCT_GROUPS,
        })
        const products = response?.products ?? []
        for (const product of products) {
          const edition = mapProduct(product)
          if (!edition) continue
          const { work } = edition
          if (
            work.releaseDate &&
            work.releaseDate <= today &&
            work.authors.some((name) => authorKey(name) === identity)
          ) {
            works.set(work.key, work)
          }
        }
        if (
          products.length < PAGE_SIZE ||
          (page + 1) * PAGE_SIZE >= (response?.total_results ?? 0)
        )
          break
      }
      return [...works.values()]
        .sort((a, b) =>
          (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""),
        )
        .slice(0, limit)
    },
  )
}

export async function audibleSimilar(
  asin: string,
  limit = 10,
): Promise<CatalogWork[]> {
  if (limit < 1) return []
  const requested = Math.min(PAGE_SIZE, Math.max(20, limit))
  const works = await cachedList(
    `${asin}:${requested}`,
    "audible:similar:",
    cacheTtl.similar,
    async () => {
      const today = new Date().toISOString().slice(0, 10)
      const response = await audible<{ similar_products?: AudibleProduct[] }>(
        {
          num_results: String(requested),
          response_groups: PRODUCT_GROUPS,
        },
        `/${asin}/sims`,
      )
      return (response?.similar_products ?? []).flatMap((product) => {
        const edition = mapProduct(product)
        const work = edition?.work
        return work?.releaseDate &&
          work.releaseDate <= today &&
          product.asin !== asin
          ? [work]
          : []
      })
    },
  )
  return works.slice(0, limit)
}
