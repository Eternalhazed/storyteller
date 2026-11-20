/**
 * Reading the text of an EPUB for X-Ray generation.
 *
 * This is the only part of the package that loads
 * `@storyteller-platform/align`, and with it native and WebAssembly code.
 * Everything else can run anywhere, so a server can read the book in a worker
 * and do the rest in its main process.
 */
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { extractSentences } from "@storyteller-platform/align"

import type { BookSource } from "./segments.ts"

export interface ReadBookSourceOptions {
  primaryLocale?: Intl.Locale
}

/**
 * Read every sentence of an EPUB in reading order, with a fingerprint of the
 * file they came from.
 *
 * Sentence `n` of chapter `id` is the sentence that
 * `@storyteller-platform/align` wraps in `<span id="{id}-s{n}">` when it
 * marks up the same EPUB.
 */
export async function readBookSource(
  epubPath: string,
  options: ReadBookSourceOptions = {},
): Promise<BookSource> {
  const sha256 = createHash("sha256")
    .update(await readFile(epubPath))
    .digest("hex")

  return { sha256, chapters: await extractSentences(epubPath, options) }
}
