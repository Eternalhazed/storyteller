import type { XrayChapter } from "./model.ts"

export interface BookSourceChapter {
  /** The spine item's manifest id; the prefix of its sentence element ids. */
  id: string
  href: string
  sentences: {
    text: string
    /** Whether this sentence ends its text block (paragraph, heading, …). */
    endsBlock: boolean
  }[]
}

/** The text of a book, as read from its EPUB by `readBookSource`. */
export interface BookSource {
  /** SHA-256 of the EPUB the sentences were read from. */
  sha256: string
  chapters: BookSourceChapter[]
}

export interface BookText {
  chapters: XrayChapter[]
  /** Every sentence of the book in reading order; index is the ordinal. */
  sentences: string[]
  /** Whether each sentence ends its text block. */
  endsBlock: boolean[]
}

/**
 * How much text a string holds: its characters, not counting whitespace.
 *
 * Positions in a book are measured in these units because whitespace is the
 * one thing that differs between an EPUB's source and what a reading system
 * shows, so a count without it can be made on either side and compared.
 */
export function textLength(text: string): number {
  return text.replace(/\s+/gu, "").length
}

/** Lay every sentence of the book out on one number line. */
export function flattenBook(book: BookSourceChapter[]): BookText {
  const chapters: XrayChapter[] = []
  const sentences: string[] = []
  const endsBlock: boolean[] = []

  for (const chapter of book) {
    if (!chapter.sentences.length) continue
    chapters.push({
      id: chapter.id,
      href: chapter.href,
      start: sentences.length,
      lengths: chapter.sentences.map((sentence) => textLength(sentence.text)),
    })
    for (const sentence of chapter.sentences) {
      sentences.push(sentence.text)
      endsBlock.push(sentence.endsBlock)
    }
  }

  return { chapters, sentences, endsBlock }
}

const UNSPACED_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/gu

/** A rough model-token count: enough to size passages, not to bill by. */
export function estimateTokens(text: string): number {
  const unspaced = text.match(UNSPACED_CHARACTER)?.length ?? 0
  return unspaced + Math.ceil((text.length - unspaced) / 4)
}

export interface SegmentRange {
  start: number
  end: number
}

export interface SegmentOptions {
  /** Upper bound on the estimated size of one passage. */
  maxTokens?: number
}

export const DEFAULT_SEGMENT_TOKENS = 4000

/** A passage with less text than this holds no story of its own. */
export const MIN_SEGMENT_TOKENS = 60

/**
 * Cut the book into passages for the model to read one at a time.
 *
 * A passage never crosses a chapter boundary. A chapter longer than
 * `maxTokens` is cut into equal parts, each ending at a paragraph break
 * where one is close enough. A sliver left at the end of a chapter joins the
 * passage before it, so the chapter's closing lines are always read.
 */
export function segmentBook(
  book: BookText,
  options: SegmentOptions = {},
): SegmentRange[] {
  const maxTokens = options.maxTokens ?? DEFAULT_SEGMENT_TOKENS
  const segments: SegmentRange[] = []

  for (const chapter of book.chapters) {
    const chapterEnd = chapter.start + chapter.lengths.length
    const sizes = book.sentences
      .slice(chapter.start, chapterEnd)
      .map(estimateTokens)
    const total = sizes.reduce((sum, size) => sum + size, 0)
    const parts = Math.max(1, Math.ceil(total / maxTokens))
    const target = total / parts

    const firstOfChapter = segments.length
    let start = chapter.start
    let size = 0
    for (let ordinal = chapter.start; ordinal < chapterEnd; ordinal++) {
      size += sizes[ordinal - chapter.start] ?? 0
      const isLast = ordinal === chapterEnd - 1
      const atBreak = size >= target && book.endsBlock[ordinal]
      const overfull = size >= target * 1.25
      if (isLast && size < MIN_SEGMENT_TOKENS) {
        const previous = segments[segments.length - 1]
        if (previous && segments.length > firstOfChapter) {
          previous.end = ordinal + 1
          break
        }
      }
      if (isLast || atBreak || overfull) {
        segments.push({ start, end: ordinal + 1 })
        start = ordinal + 1
        size = 0
      }
    }
  }

  return segments
}
