import { chmod, mkdir, readdir, rm, stat } from "node:fs/promises"
import { dirname, join, relative } from "node:path"

import { isHiddenFile } from "@storyteller/fs"

import { copyWithHardlink, copyWithReflink, move } from "@/assets/fs"
import { type ScanFormat } from "@/assets/library/scanner/types"
import {
  releasePrefixAfterSettle,
  suppressPrefix,
} from "@/assets/library/scanner/write-intent"
import {
  getInternalAudioDirectory,
  getInternalBookDirectory,
  getInternalEpubFilepath,
  getInternalReadaloudFilepath,
} from "@/assets/paths"
import { isAudioFile } from "@/audio"
import { type BookWithRelations, updateBook } from "@/database/books"
import { addIgnoreRule } from "@/database/importRules"
import { type ImportMode } from "@/database/settingsTypes"

type Relocator = (source: string, destination: string) => Promise<void>

function resolveRelocator(
  importMode: Exclude<ImportMode, "reference">,
  bookUuid: BookWithRelations["uuid"],
  ignorePath?: string,
): Relocator {
  let resolver: Relocator

  switch (importMode) {
    case "move":
      resolver = move
      break
    case "hardlink":
      resolver = copyWithHardlink
      break
    case "copy":
      resolver = async (source, destination) => {
        await copyWithReflink(source, destination)
        // a copy from a read-only source (a download still being seeded)
        // keeps its mode; the library's copy has to be writable.
        const { mode } = await stat(destination)
        if (!(mode & 0o200)) await chmod(destination, mode | 0o200)
      }
      break
  }

  return async (source, destination) => {
    suppressPrefix(source)
    suppressPrefix(destination)
    try {
      // doesn't make sense to add for move
      if (importMode === "hardlink" || importMode === "copy") {
        // make sure og file that's left behind isnt reimported. ignorePath
        // lets callers ignore the original source when the bytes we copy from
        // live somewhere else (e.g. the tmp epub3 upgrade in copy mode).
        await addIgnoreRule(ignorePath ?? source, {
          source: "import-relocate",
          bookUuid,
        })
      }
      await resolver(source, destination)
    } finally {
      releasePrefixAfterSettle(destination)
      releasePrefixAfterSettle(source)
    }
  }
}

function isAlreadyInternal(filepath: string, book: BookWithRelations): boolean {
  const internalDir = getInternalBookDirectory(book)
  return filepath === internalDir || filepath.startsWith(internalDir + "/")
}

export type RelocateResult = {
  book: BookWithRelations
  filepath: string
}

/**
 * move the file depending on the import mode, and update the format in the db.
 *
 * `ignorePath` overrides which path the import-relocate ignore rule records.
 * pass it when `filepath` is a copy of the real source (e.g. a tmp epub3
 * upgrade) so the original on-disk file gets ignored, not the throwaway copy.
 */
export async function relocateIfNeeded(
  book: BookWithRelations,
  filepath: string,
  format: ScanFormat,
  importMode: ImportMode,
  ignorePath?: string,
): Promise<RelocateResult> {
  if (importMode === "reference") {
    return { book, filepath }
  }
  if (isAlreadyInternal(filepath, book)) {
    return { book, filepath }
  }

  const relocator = resolveRelocator(importMode, book.uuid, ignorePath)

  if (format === "ebook") {
    const dest = getInternalEpubFilepath(book)
    await mkdir(dirname(dest), { recursive: true })
    await relocator(filepath, dest)
    const updated = await updateBook(book.uuid, null, {
      ebook: { filepath: dest, missing: false },
    })
    return { book: updated, filepath: dest }
  }

  if (format === "readaloud") {
    const dest = getInternalReadaloudFilepath(book)
    await mkdir(dirname(dest), { recursive: true })
    await relocator(filepath, dest)
    const updated = await updateBook(book.uuid, null, {
      readaloud: {
        filepath: dest,
        missing: false,
        status: book.readaloud?.status ?? "ALIGNED",
        currentStage: book.readaloud?.currentStage ?? "SPLIT_TRACKS",
      },
    })
    return { book: updated, filepath: dest }
  }

  // audiobook: filepath is the source directory. tracks may sit in
  // sub-folders (one per disc); track discovery is recursive, so the copy
  // keeps the same layout and loses nothing.
  const destDir = getInternalAudioDirectory(book)
  await mkdir(destDir, { recursive: true })
  const entries = await readdir(filepath, {
    recursive: true,
    withFileTypes: true,
  })
  let leftBehind = false
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!isAudioFile(entry.name) || isHiddenFile(entry.name)) {
      leftBehind = true
      continue
    }
    const source = join(entry.parentPath, entry.name)
    const dest = join(destDir, relative(filepath, source))
    await mkdir(dirname(dest), { recursive: true })
    await relocator(source, dest)
  }

  // dont remove the dir if theres other stuff in there
  if (importMode === "move" && !leftBehind) {
    await rm(filepath, { recursive: true })
  }
  const updated = await updateBook(book.uuid, null, {
    audiobook: { filepath: destDir, missing: false },
  })
  return { book: updated, filepath: destDir }
}
