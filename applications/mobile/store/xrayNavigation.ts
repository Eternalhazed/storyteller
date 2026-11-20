import {
  type Xray,
  type XrayEntityView,
  chapterIndexForHref,
  chapterIndexOf,
  locateSentence,
} from "@storyteller-platform/xray/view"

import {
  type ReadiumLink,
  type ReadiumLocator,
  type ReadiumManifest,
} from "@/modules/readium/src/Readium.types"
import { type ReturnToPosition } from "@/store/slices/bookshelfSlice"
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
  returnPosition?: ReturnToPosition | null | undefined
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

export type XrayDetailRow =
  | { kind: "heading"; key: string; title: string }
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
    rows.push({ kind: "heading", key: "facts", title: "Key facts" })
    entity.facts.forEach((fact, index) => {
      rows.push({
        kind: "fact",
        key: `fact:${index}`,
        ordinal: fact.sentence,
        text: fact.text,
      })
    })
  }
  rows.push({
    kind: "heading",
    key: "mentions",
    title: `Mentions (${entity.mentions.length})`,
  })

  const direction = newestFirst ? -1 : 1
  let chapterIndex = newestFirst ? xray.chapters.length - 1 : 0
  let previousChapter = -1
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
    if (previousChapter !== chapterIndex) {
      rows.push({
        kind: "heading",
        key: `chapter:${chapterIndex}`,
        title: chapterLinks[chapterIndex]?.title ?? "Untitled chapter",
      })
      previousChapter = chapterIndex
    }
    rows.push({
      kind: "mention",
      key: `mention:${ordinal}`,
      ordinal,
      text: xray.sentences[ordinal] ?? "Sentence text unavailable.",
    })
  }
  return rows
}
