import {
  type Xray,
  type XrayEntityView,
  chapterIndexForHref,
  chapterIndexOf,
  locateSentence,
} from "@storyteller/xray/view"

import {
  type ReadiumLink,
  type ReadiumLocator,
  type ReadiumManifest,
} from "@/modules/readium/src/Readium.types"
import { type Passage } from "@/store/slices/passageSlice"
import { getFurthestReadLocator } from "@/store/xrayBoundary"

export type XrayScope = "now" | "chapter" | "book"

export const xrayScopeLabels: Record<XrayScope, string> = {
  now: "Just now",
  chapter: "This chapter",
  book: "Book so far",
}

export const xrayEntityTypeLabels: Record<XrayEntityView["type"], string> = {
  character: "Person",
  place: "Place",
  group: "Group",
  thing: "Thing",
}

const scopes: XrayScope[] = ["now", "chapter", "book"]

/** The views must come from viewXray at the same spoiler boundary. */
export function getScopedXrayEntities({
  xray,
  views,
  boundary,
  scope,
  type,
}: {
  xray: Xray
  views: XrayEntityView[]
  boundary: number
  scope: XrayScope
  type: XrayEntityView["type"] | null
}): { scope: XrayScope; entities: XrayEntityView[] } {
  const entities = type ? views.filter((entity) => entity.type === type) : views
  const chapterStart = xray.chapters[chapterIndexOf(xray, boundary)]?.start

  for (const candidate of scopes.slice(scopes.indexOf(scope))) {
    if (candidate === "book") return { scope: candidate, entities }
    const start = candidate === "now" ? boundary - 39 : chapterStart
    if (start === undefined) continue

    const ranked = entities.flatMap((entity) => {
      const lastMention = entity.mentions.at(-1)
      if (lastMention === undefined || lastMention < start) return []
      if (candidate === "now") return [{ entity, score: lastMention }]

      let first = 0
      let end = entity.mentions.length
      while (first < end) {
        const middle = Math.floor((first + end) / 2)
        if (entity.mentions[middle]! < start) first = middle + 1
        else end = middle
      }
      return [{ entity, score: entity.mentions.length - first }]
    })
    if (ranked.length) {
      ranked.sort((a, b) => b.score - a.score)
      return { scope: candidate, entities: ranked.map(({ entity }) => entity) }
    }
  }

  return { scope: "book", entities }
}

export function getXrayEntitySummary(entity: XrayEntityView): string | null {
  if (entity.description) return entity.description
  let latest: XrayEntityView["facts"][number] | undefined
  for (const fact of entity.facts) {
    if (!latest || fact.sentence >= latest.sentence) latest = fact
  }
  return latest?.text ?? null
}

export type XrayChapterLink = {
  href: string
  type: string | null
  title: string
}

/** Match the open edition's links, not the generation EPUB's path or MIME type. */
export function getXrayChapterLinks(
  xray: Xray,
  manifest: ReadiumManifest | null | undefined,
): (XrayChapterLink | null)[] {
  const chapters: (XrayChapterLink | null)[] = xray.chapters.map(() => null)
  if (!manifest) return chapters

  function indexForLink(link: ReadiumLink) {
    if (!link.href) return -1
    try {
      return chapterIndexForHref(xray, link.href)
    } catch {
      return -1
    }
  }

  for (const link of manifest.readingOrder) {
    const index = indexForLink(link)
    if (index === -1 || chapters[index]) continue
    chapters[index] = {
      href: link.href.split("#")[0]!,
      type: link.type,
      title: "Untitled chapter",
    }
  }

  const titled = new Set<number>()
  function visitToc(links: ReadiumLink[]) {
    for (const link of links) {
      const index = indexForLink(link)
      if (index !== -1) {
        chapters[index] ??= {
          href: link.href.split("#")[0]!,
          type: link.type ?? null,
          title: "Untitled chapter",
        }
        if (link.title && !titled.has(index)) {
          chapters[index]!.title = link.title
          titled.add(index)
        }
      }
      if (link.children) visitToc(link.children)
    }
  }
  visitToc(manifest.toc ?? [])
  return chapters
}

export function buildXrayJump({
  xray,
  ordinal,
  chapterLinks,
  format,
  currentLocator,
  returnPosition,
}: {
  xray: Xray
  ordinal: number
  chapterLinks: readonly (XrayChapterLink | null)[]
  format: "readaloud" | "ebook" | "audiobook"
  currentLocator: ReadiumLocator | null | undefined
  returnPosition?: Passage | null | undefined
}): {
  locator: ReadiumLocator
  currentLocator: ReadiumLocator | undefined
} | null {
  if (format === "audiobook") return null
  const sentence = locateSentence(xray, ordinal)
  if (!sentence) return null
  const chapter = chapterLinks[sentence.chapter]
  if (!chapter?.type) return null
  const highlight = xray.sentences[ordinal]

  return {
    locator: {
      href: chapter.href,
      type: chapter.type,
      title: chapter.title,
      locations: {
        // Readium anchors plain ebooks by text quote first; this text-based
        // progression is only a fallback when the quote cannot be found.
        ...(format === "readaloud" && { fragments: [sentence.fragment] }),
        progression: sentence.progression,
      },
      ...(format === "ebook" && highlight && { text: { highlight } }),
    },
    // The jump returns to the furthest place the reader has reached, so
    // exploring old mentions never loses it, and neither does a return
    // position left over from before they read on.
    currentLocator: getFurthestReadLocator(
      xray,
      currentLocator,
      returnPosition,
    ),
  }
}

type XrayChapterRow = {
  kind: "chapter"
  key: string
  title: string
  /** Mentions listed under this chapter. */
  count: number
}

export type XrayDetailRow =
  | {
      kind: "section"
      key: "facts" | "mentions"
      title: string
      count: number
    }
  | XrayChapterRow
  | { kind: "fact"; key: string; ordinal: number; text: string }
  | { kind: "mention"; key: string; ordinal: number; text: string }

/** A flat, virtualizable detail list; grouping walks the sorted mentions once. */
export function getXrayDetailRows({
  xray,
  entity,
  chapterLinks,
  newestFirst,
}: {
  xray: Xray
  entity: XrayEntityView
  chapterLinks: readonly (XrayChapterLink | null)[]
  newestFirst: boolean
}): XrayDetailRow[] {
  const rows: XrayDetailRow[] = []
  if (entity.facts.length) {
    rows.push({
      kind: "section",
      key: "facts",
      title: "Key facts",
      count: entity.facts.length,
    })
    // One order for the whole entry: the sort control above the list says
    // "Newest first", so the facts under it must be newest first too.
    const facts = entity.facts
      .map((fact, index) => ({ fact, index }))
      .sort((a, b) =>
        newestFirst
          ? b.fact.sentence - a.fact.sentence
          : a.fact.sentence - b.fact.sentence,
      )
    for (const { fact, index } of facts) {
      rows.push({
        kind: "fact",
        key: `fact:${index}`,
        ordinal: fact.sentence,
        text: fact.text,
      })
    }
  }
  rows.push({
    kind: "section",
    key: "mentions",
    title: "Mentions",
    count: entity.mentions.length,
  })

  const direction = newestFirst ? -1 : 1
  let chapterIndex = newestFirst ? xray.chapters.length - 1 : 0
  let previousChapter = -1
  let chapterRow: XrayChapterRow | undefined
  for (
    let index = newestFirst ? entity.mentions.length - 1 : 0;
    index >= 0 && index < entity.mentions.length;
    index += direction
  ) {
    const ordinal = entity.mentions[index]!
    let chapter = xray.chapters[chapterIndex]
    while (
      chapter &&
      (newestFirst
        ? ordinal < chapter.start
        : ordinal >= chapter.start + chapter.lengths.length)
    ) {
      chapterIndex += direction
      chapter = xray.chapters[chapterIndex]
    }
    if (
      !chapter ||
      ordinal < chapter.start ||
      ordinal >= chapter.start + chapter.lengths.length
    ) {
      continue
    }
    if (previousChapter !== chapterIndex || !chapterRow) {
      chapterRow = {
        kind: "chapter",
        key: `chapter:${chapterIndex}`,
        title: chapterLinks[chapterIndex]?.title ?? "Untitled chapter",
        count: 0,
      }
      rows.push(chapterRow)
      previousChapter = chapterIndex
    }
    chapterRow.count += 1
    rows.push({
      kind: "mention",
      key: `mention:${ordinal}`,
      ordinal,
      text: xray.sentences[ordinal] ?? "Sentence text unavailable.",
    })
  }
  return rows
}

/**
 * Splits a sentence around the names it uses for an entity, so the UI can
 * emphasise them. Matching ignores case and never starts or ends inside a word.
 */
export function splitXrayNames(
  text: string,
  names: readonly string[],
): { text: string; name: boolean }[] {
  const alternatives = names
    .filter((name) => name.trim())
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
  if (!alternatives.length) return [{ text, name: false }]
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  )
  const parts: { text: string; name: boolean }[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), name: false })
    }
    parts.push({ text: match[0], name: true })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), name: false })
  return parts
}
