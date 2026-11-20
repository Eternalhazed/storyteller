/**
 * Reading an X-Ray file at a position in the book.
 *
 * Everything here is pure and free of Node APIs, so reading apps can share
 * it. The one rule it enforces: nothing stamped after the reader's position
 * is ever returned.
 */
import { AliasMatcher, normalizeText } from "./matcher.ts"
import type { Xray, XrayEntityType, XrayFact, XrayStamped } from "./model.ts"

export type { Xray, XrayEntityType, XrayFact, XrayStamped } from "./model.ts"
export { XRAY_SCHEMA_VERSION } from "./version.ts"

export interface XrayEntityView {
  id: number
  type: XrayEntityType
  name: string
  /** Every name the reader has seen this entity called. */
  aliases: string[]
  description: string | null
  facts: XrayFact[]
  /** Ordinals of the sentences that name this entity, ascending. */
  mentions: number[]
}

function latest(items: readonly XrayStamped[], boundary: number) {
  let found: XrayStamped | undefined
  for (const item of items) {
    if (item.at <= boundary && (!found || item.at >= found.at)) found = item
  }
  return found
}

/**
 * The entities a reader who has reached sentence `boundary` knows about,
 * most mentioned first.
 *
 * A mention counts only once the text has tied its name to the entity, so a
 * name whose owner is revealed later stays hidden until the reveal.
 */
export function viewXray(xray: Xray, boundary: number): XrayEntityView[] {
  const views: XrayEntityView[] = []

  for (const entity of xray.entities) {
    const mentions: number[] = []
    for (const [ordinal, aliasIndex] of entity.mentions) {
      if (ordinal > boundary) break
      const alias = entity.aliases[aliasIndex]
      if (alias && alias.at <= boundary) mentions.push(ordinal)
    }
    if (!mentions.length) continue

    const aliases = entity.aliases
      .filter((alias) => alias.at <= boundary)
      .map((alias) => alias.text)

    views.push({
      id: entity.id,
      type: entity.type,
      name: latest(entity.names, boundary)?.text ?? aliases[0] ?? "",
      aliases,
      description: latest(entity.descriptions, boundary)?.text ?? null,
      facts: entity.facts.filter((fact) => fact.at <= boundary),
      mentions,
    })
  }

  return views.sort((a, b) => b.mentions.length - a.mentions.length)
}

/**
 * The entity a piece of selected text refers to, if the reader knows it.
 *
 * The selection may be a name exactly, or a longer stretch containing one.
 */
export function findEntity(
  views: readonly XrayEntityView[],
  text: string,
): XrayEntityView | null {
  // The same matching the index was built with, so the common word "will"
  // is not taken for the character Will.
  const selection = normalizeText(text).trim()
  const matches = new AliasMatcher(
    views.flatMap((view) =>
      view.aliases.map((alias) => [alias, view] as const),
    ),
  ).find(selection)
  return (
    matches.reduce<(typeof matches)[number] | undefined>(
      (best, match) => (best && best.length >= match.length ? best : match),
      undefined,
    )?.value ?? null
  )
}

/** Summaries of every passage the reader has finished, in order. */
export function storySoFar(xray: Xray, boundary: number): string[] {
  return xray.segments.flatMap((segment) =>
    segment.summary !== null && segment.end - 1 <= boundary
      ? [segment.summary]
      : [],
  )
}

export interface XraySentenceLocation {
  /** Index into `xray.chapters`. */
  chapter: number
  href: string
  /** The sentence's number within its chapter. */
  sentence: number
  /** The id of the sentence's element in a book with narration. */
  fragment: string
  /**
   * How far into the chapter's text the sentence starts, from 0 to 1. This
   * measures text, where reading systems usually measure layout, so on its
   * own it lands a reader near the sentence, not on it.
   */
  progression: number
}

/** Index of the chapter holding sentence `ordinal`, or -1. */
export function chapterIndexOf(xray: Xray, ordinal: number): number {
  return xray.chapters.findIndex(
    (chapter) =>
      ordinal >= chapter.start &&
      ordinal < chapter.start + chapter.lengths.length,
  )
}

/** Where in the book sentence `ordinal` is. */
export function locateSentence(
  xray: Xray,
  ordinal: number,
): XraySentenceLocation | null {
  const index = chapterIndexOf(xray, ordinal)
  const chapter = xray.chapters[index]
  if (!chapter) return null

  const sentence = ordinal - chapter.start
  let before = 0
  let total = 0
  chapter.lengths.forEach((length, i) => {
    if (i < sentence) before += length
    total += length
  })

  return {
    chapter: index,
    href: chapter.href,
    sentence,
    fragment: `${chapter.id}-s${sentence}`,
    progression: total ? before / total : 0,
  }
}

/** The file an href names: no fragment or query, and percent-decoded. */
function hrefPath(href: string): string {
  const path = (href.split(/[?#]/)[0] ?? "").replace(/^\/+/, "")
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/**
 * Index of the chapter a reading-system href points into, or -1.
 *
 * Reading systems resolve hrefs against different bases and may or may not
 * percent-encode them, so the two are compared decoded, and either may be
 * the tail of the other.
 */
export function chapterIndexForHref(xray: Xray, href: string): number {
  const path = hrefPath(href)
  if (!path) return -1
  return xray.chapters.findIndex((chapter) => {
    const own = hrefPath(chapter.href)
    return own === path || own.endsWith(`/${path}`) || path.endsWith(`/${own}`)
  })
}

/**
 * The ordinal of the sentence under a point `progression` (0 to 1) of the way
 * through a chapter's text.
 *
 * This is an estimate: reading systems measure progression in rendered
 * layout, not characters. Callers that must not overshoot should treat the
 * result as approximate and prefer `ordinalOfFragment` when they can.
 */
export function ordinalAtProgression(
  xray: Xray,
  chapterIndex: number,
  progression: number,
): number | null {
  const chapter = xray.chapters[chapterIndex]
  if (!chapter) return null

  const total = chapter.lengths.reduce((sum, length) => sum + length, 0)
  const target = Math.min(Math.max(progression, 0), 1) * total
  let end = 0
  for (let sentence = 0; sentence < chapter.lengths.length; sentence++) {
    end += chapter.lengths[sentence] ?? 0
    if (end > target) return chapter.start + sentence
  }
  return chapter.start + chapter.lengths.length - 1
}

/**
 * The ordinal of the sentence that holds the character `offset` characters
 * into a chapter's text, not counting whitespace: for a reading system that
 * can say exactly how much text comes before a point on screen.
 */
export function ordinalAtTextOffset(
  xray: Xray,
  chapterIndex: number,
  offset: number,
): number | null {
  const chapter = xray.chapters[chapterIndex]
  if (!chapter?.lengths.length) return null

  let end = 0
  for (let sentence = 0; sentence < chapter.lengths.length; sentence++) {
    end += chapter.lengths[sentence] ?? 0
    if (end > offset) return chapter.start + sentence
  }
  return chapter.start + chapter.lengths.length - 1
}

/**
 * The last sentence of the same chapter that lies within `characters` of
 * text after the start of sentence `ordinal`.
 *
 * A reader's position usually marks the top of the page in view; this
 * stretches it to cover roughly the rest of that page.
 */
export function advanceByCharacters(
  xray: Xray,
  ordinal: number,
  characters: number,
): number {
  const chapter = xray.chapters[chapterIndexOf(xray, ordinal)]
  if (!chapter) return ordinal

  let covered = 0
  let last = ordinal
  for (
    let sentence = ordinal - chapter.start;
    sentence < chapter.lengths.length;
    sentence++
  ) {
    covered += chapter.lengths[sentence] ?? 0
    if (covered > characters) break
    last = chapter.start + sentence
  }
  return last
}

/** The ordinal of the sentence with element id `fragment`, if it is one. */
export function ordinalOfFragment(xray: Xray, fragment: string): number | null {
  const match = /^(.*)-s(\d+)(?:-w\d+)?$/.exec(fragment.replace(/^#/, ""))
  if (!match) return null

  const chapter = xray.chapters.find((chapter) => chapter.id === match[1])
  const sentence = Number(match[2])
  if (!chapter || sentence >= chapter.lengths.length) return null
  return chapter.start + sentence
}
