import { basename } from "node:path/posix"

import { Epub, type ParsedXml } from "@storyteller-platform/epub"

import { parseDom } from "./parseDom.ts"
import { segmentChapter } from "./segmentation.ts"
import { inlineFootnotes, liftText } from "./transform.ts"

/**
 * Parse a chapter body, lift its text, and split it into sentences.
 *
 * This is the single source of sentence boundaries: `markupChapter` turns
 * each non-blank sentence into a `<span id="{chapterId}-s{n}">`, and
 * `getChapterSentences` returns the same sentences in the same order, so
 * index `n` here is always the `n` in that span id.
 */
export async function liftAndSegment(
  body: ParsedXml[number],
  locale: Intl.Locale | null,
) {
  const original = parseDom(Epub.getXmlChildren(body))
  const inlined = inlineFootnotes(original)
  const lifted = liftText(inlined.root)
  const segmentation = await segmentChapter(lifted.result, {
    primaryLocale: locale,
  })

  return { original, inlined, lifted, segmentation }
}

export interface ChapterSentence {
  /** The sentence text, without the trailing block-break newline. */
  text: string
  /** Whether this sentence ends its text block (paragraph, heading, …). */
  endsBlock: boolean
}

export async function getChapterSentences(
  chapterXml: ParsedXml,
  locale: Intl.Locale | null,
): Promise<ChapterSentence[]> {
  const html = Epub.findXmlChildByName("html", chapterXml)
  if (!html) throw new Error("Invalid XHTML document: no html element")

  const body = Epub.findXmlChildByName("body", html["html"])
  if (!body) throw new Error("Invalid XHTML document: No body element")

  const { segmentation } = await liftAndSegment(body, locale)

  const sentences: ChapterSentence[] = []
  for (const sentence of segmentation) {
    const endsBlock = sentence.text.endsWith("\n")
    if (!sentence.text.match(/\S/)) {
      // Trailing whitespace can be split off from the sentence it follows,
      // taking the block break with it.
      const previous = sentences.at(-1)
      if (endsBlock && previous) previous.endsBlock = true
      continue
    }
    sentences.push({ text: sentence.text.replace(/\n$/, ""), endsBlock })
  }
  return sentences
}

export interface BookChapterSentences {
  /** The spine item's manifest id; the prefix of its sentence span ids. */
  id: string
  href: string
  sentences: ChapterSentence[]
}

export interface ExtractSentencesOptions {
  primaryLocale?: Intl.Locale
}

/**
 * Read every spine item of an EPUB, in reading order, as plain sentences.
 *
 * Sentence `n` of chapter `id` is the sentence that `markup` wraps in
 * `<span id="{id}-s{n}">` when given the same EPUB.
 */
export async function extractSentences(
  input: string,
  options: ExtractSentencesOptions = {},
): Promise<BookChapterSentences[]> {
  using epub = await Epub.from(input)

  const primaryLocale = options.primaryLocale ?? (await epub.getLanguage())
  const spine = await epub.getSpineItems()
  const manifest = await epub.getManifest()

  const chapters: BookChapterSentences[] = []
  for (const spineItem of spine) {
    if (manifest[spineItem.id]?.properties?.includes("nav")) continue

    let chapterXml: ParsedXml
    try {
      chapterXml = await epub.readXhtmlItemContents(spineItem.id)
    } catch (cause) {
      throw new Error(`Failed to read spine item ${basename(spineItem.href)}`, {
        cause,
      })
    }

    chapters.push({
      id: spineItem.id,
      href: spineItem.href,
      sentences: await getChapterSentences(chapterXml, primaryLocale),
    })
  }

  return chapters
}
