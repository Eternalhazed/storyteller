import { randomUUID } from "node:crypto"
import { basename, dirname, extname, sep } from "node:path"

import { NextResponse } from "next/server"
import { z } from "zod"

import { Epub, MemoryAdapter } from "@storyteller/epub"
import { isHiddenFile } from "@storyteller/fs"

import { deleteAssets } from "@/assets/fs"
import { filepathFolder } from "@/assets/library/paths"
import { type Candidate } from "@/assets/library/scanner/types"
import { isAudioFile, isZipArchive } from "@/audio"
import { withHasPermission } from "@/auth/auth"
import { deleteBook, getBook, getBooks } from "@/database/books"
import {
  type Epub2ImportStrategy,
  type ImportMode,
} from "@/database/settingsTypes"
import { isEpubVersionError } from "@/epub"
import { type UUID } from "@/uuid"

import { parseGetBooksOptions } from "./parseBookQuery"

export const dynamic = "force-dynamic"

/**
 * @summary List all books in the library
 * @desc Use the `alignedOnly` param to limit results to books that
 *       have been aligned by Storyteller successfully.
 */
export const GET = withHasPermission("bookList")(async (request) => {
  const parsed = parseGetBooksOptions(request.nextUrl.searchParams)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const books = await getBooks(null, request.auth.user.id, {
    ...parsed.opts,
    includeManifest: false,
  })

  return NextResponse.json(books)
})

export const DELETE = withHasPermission("bookDelete")(async (request) => {
  const { books: bookUuids, preventReImport } = (await request.json()) as {
    books: UUID[]
    preventReImport?: boolean
  }

  const books = await getBooks(bookUuids, request.auth.user.id)

  if (books.length !== bookUuids.length) {
    return Response.json({ message: "Not found" }, { status: 404 })
  }

  for (const book of books) {
    await deleteBook(book.uuid, { preventReImport })
    await deleteAssets(book)
  }

  return new Response(null, { status: 204 })
})

async function probeEpub2(filepath: string): Promise<boolean> {
  try {
    using _epub = await Epub.using(MemoryAdapter).from(filepath)
    return false
  } catch (error) {
    if (isEpubVersionError(error)) return true
    throw error
  }
}

/**
 * @summary Import a book from file paths on the server
 * @desc When `epub2Strategy` is `"auto"` (or omitted), the endpoint probes
 *       each epub to check its version. If any epub is version 2 and the
 *       import mode is not "copy" (which always upgrades automatically), the
 *       response is `{ epub2Detected: true, paths: [...] }` with status 200 -
 *       the caller should re-submit with an explicit `epub2Strategy` value.
 *
 *       When `epub2Strategy` is an explicit value ("replace", "skip",
 *       "backup-and-convert", "convert-alongside"), the import proceeds
 *       using that strategy.
 *
 *       Audio files may sit in one folder or in its disc sub-folders.
 *
 *       Pass `bookUuid` to make the import safe to repeat: the book is
 *       created with that id, and if it already exists, only formats it does
 *       not have yet are attached; existing formats are never replaced. Pass
 *       `exactCollection: true` to file the book into `collection` only,
 *       rather than also into collections named like its folders.
 */
export const POST = withHasPermission("bookCreate")(async (request) => {
  const {
    paths,
    collection,
    importMode,
    epub2Strategy = "auto",
    bookUuid,
    exactCollection = false,
  } = (await request.json()) as {
    paths: string[]
    collection: UUID | undefined
    importMode: ImportMode
    epub2Strategy?: Epub2ImportStrategy | "auto"
    bookUuid?: UUID
    exactCollection?: boolean
  }

  if (bookUuid !== undefined) {
    if (!z.uuid().safeParse(bookUuid).success) {
      return Response.json(
        { message: "bookUuid must be a UUID" },
        { status: 400 },
      )
    }
    const existing = await getBook(bookUuid)
    if (existing && !(await getBook(bookUuid, request.auth.user.id))) {
      return Response.json({ message: "Not found" }, { status: 404 })
    }
  }

  const epubs = paths.filter((path) => extname(path) === ".epub")
  const audio = paths.filter(
    (path) => (isAudioFile(path) || isZipArchive(path)) && !isHiddenFile(path),
  )

  // when strategy is "auto" and import mode could be affected by the user's
  // choice, probe all epubs and ask if any are epub2.
  if (epub2Strategy === "auto" && importMode !== "copy" && epubs.length > 0) {
    const epub2Paths: string[] = []

    for (const epubPath of epubs) {
      const is2 = await probeEpub2(epubPath)
      if (is2) epub2Paths.push(epubPath)
    }

    if (epub2Paths.length > 0) {
      return Response.json({ epub2Detected: true, paths: epub2Paths })
    }
  }

  const newBookUuid = bookUuid ?? randomUUID()
  const resolvedStrategy = epub2Strategy === "auto" ? undefined : epub2Strategy

  const candidates: Candidate[] = []

  for (const epubPath of epubs) {
    candidates.push({
      folder: filepathFolder(epubPath),
      bookUuidHint: newBookUuid,
      format: "ebook",
      filepath: epubPath,
      titleHint: basename(epubPath, extname(epubPath)),
      ...(collection && { collections: [collection] }),
      exactCollections: exactCollection,
      attachIfMissing: bookUuid !== undefined,
      importMode,
      ...(resolvedStrategy && { epub2ImportStrategy: resolvedStrategy }),
    })
  }

  if (audio.length) {
    const audioDirectory =
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      audio.length === 1 ? dirname(audio[0]!) : longestPrefix(audio)
    // one folder, or one folder of disc sub-folders
    const depth = audioDirectory.split(sep).length
    const misplaced = audio.find((path) => path.split(sep).length > depth + 2)
    if (misplaced) {
      return Response.json(
        {
          message: `Audio files must be in one folder or its disc sub-folders. ${misplaced} is not directly under ${audioDirectory} or one of its sub-folders`,
        },
        { status: 405 },
      )
    }

    candidates.push({
      folder: audioDirectory,
      bookUuidHint: newBookUuid,
      format: "audiobook",
      filepath: audioDirectory,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      titleHint: basename(audio[0]!, extname(audio[0]!)),
      ...(collection && { collections: [collection] }),
      exactCollections: exactCollection,
      attachIfMissing: bookUuid !== undefined,
      importMode,
    })
  }

  const { scan } = await import("@/assets/library/scanner/scan")
  await scan({
    source: "api",
    request: { kind: "candidates", candidates },
    options: { force: true },
    signal: new AbortController().signal,
  })

  const reconciled = await getBook(newBookUuid)

  if (!reconciled) {
    return Response.json(
      { message: "Unable to create book from provided paths" },
      { status: 405 },
    )
  }

  return Response.json(reconciled)
})

function longestPrefix(paths: string[]) {
  const pathsSegments = paths.map((path) => path.split(sep))
  const firstPath = pathsSegments[0]
  if (!firstPath || paths.length === 1) return firstPath?.join(sep) ?? ""
  let i = 0
  while (
    firstPath[i] !== undefined &&
    pathsSegments.every((w) => w[i] === firstPath[i])
  )
    i++

  return firstPath.slice(0, i).join(sep)
}
