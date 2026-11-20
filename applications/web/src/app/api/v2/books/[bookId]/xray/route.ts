import { type FileHandle, open, stat } from "node:fs/promises"

import { createReadableStreamFromReadable } from "@remix-run/node"

import { getXrayFilepath } from "@/assets/paths"
import { withHasPermission } from "@/auth/auth"
import { getBook } from "@/database/books"
import { getSetting } from "@/database/settings"
import { logger } from "@/logging"
import type { UUID } from "@/uuid"
import { enqueueBookXray, getJobAbortIntent } from "@/work/distributor"

export const dynamic = "force-dynamic"

type Params = Promise<{ bookId: string }>

/**
 * @description Get a book's X-Ray file. Send If-None-Match with its ETag to receive 304 when unchanged. Clients must filter the file to the reader's own position before displaying it.
 * @pathParams BookIdParamsSchemaV2
 * @response XraySchemaV2
 * @auth bearer
 * @openapi
 */
export const GET = withHasPermission<Params>("bookRead", {
  allowBasicAuth: true,
})(async (request, context) => {
  const { bookId } = await context.params
  const book = await getBook(bookId as UUID, request.auth.user.id)
  if (!book) {
    return Response.json(
      { message: `Could not find book with id ${bookId}` },
      { status: 404 },
    )
  }

  await using stack = new AsyncDisposableStack()
  let file: FileHandle
  try {
    file = stack.use(await open(getXrayFilepath(book.uuid)))
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error
    }
    return Response.json(
      { message: `No X-Ray file for book ${bookId}` },
      { status: 404 },
    )
  }

  const stats = await file.stat()
  if (stats.size === 0) {
    return Response.json(
      { message: `No X-Ray file for book ${bookId}` },
      { status: 404 },
    )
  }
  const etag = `"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`
  const headers = {
    ETag: etag,
    "Last-Modified": stats.mtime.toUTCString(),
    "Content-Type": "application/json",
    "Content-Length": String(stats.size),
    "Cache-Control": "private, no-cache",
  }
  const unchanged = request.headers
    .get("if-none-match")
    ?.split(",")
    .some((value) => {
      const tag = value.trim()
      return tag === "*" || tag.replace(/^W\//, "") === etag
    })

  if (unchanged) {
    return new Response(null, { status: 304, headers })
  }
  if (request.method === "HEAD") {
    return new Response(null, { headers })
  }

  // The response owns the handle until its stream completes or is cancelled.
  const owned = stack.move()
  const stream = file.createReadStream()
  stream.on("error", (error) => {
    const clientAbort =
      error.name === "ResponseAborted" ||
      error.message === "aborted" ||
      ("code" in error && error.code === "ERR_STREAM_PREMATURE_CLOSE")

    if (clientAbort) {
      logger.debug({ msg: "X-Ray download aborted by client", err: error })
      return
    }
    logger.error({ msg: "X-Ray download stream error", err: error })
  })
  stream.once("close", () => void owned.disposeAsync())

  return new Response(createReadableStreamFromReadable(stream), {
    headers,
  })
})

/**
 * @description Check whether a book has X-Ray without downloading it. Returns the same ETag and Last-Modified headers as GET, including on a 304 response.
 * @pathParams BookIdParamsSchemaV2
 * @auth bearer
 * @openapi
 */
export const HEAD: typeof GET = async (request, context) => {
  const response = await GET(request, context)
  if (!response || response.body === null) return response
  await response.body.cancel()
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  })
}

/**
 * @description Queue generation or regeneration of a book's X-Ray file. Requires an ebook and a configured Anthropic API key; book text is sent to Anthropic during generation.
 * @pathParams BookIdParamsSchemaV2
 * @auth bearer
 * @openapi
 */
export const POST = withHasPermission<Params>("bookProcess")(async (
  request,
  context,
) => {
  const { bookId } = await context.params
  const book = await getBook(bookId as UUID, request.auth.user.id)
  if (!book) {
    return Response.json(
      { message: `Could not find book with id ${bookId}` },
      { status: 404 },
    )
  }

  if (!book.ebook?.filepath || book.ebook.missing) {
    return Response.json(
      { message: "Cannot generate X-Ray: this book has no ebook file." },
      { status: 404 },
    )
  }

  try {
    const ebook = await stat(book.ebook.filepath)
    if (!ebook.isFile()) {
      return Response.json(
        { message: "Cannot generate X-Ray: this book has no ebook file." },
        { status: 404 },
      )
    }
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )
    ) {
      throw error
    }
    return Response.json(
      { message: "Cannot generate X-Ray: this book has no ebook file." },
      { status: 404 },
    )
  }

  const apiKey = await getSetting("xrayAnthropicApiKey")
  if (!apiKey?.trim()) {
    return Response.json(
      {
        message:
          "Configure an Anthropic API key in X-Ray settings before generating X-Ray.",
      },
      { status: 409 },
    )
  }

  const job = await enqueueBookXray(book.uuid)
  if (job.status === "PAUSED") {
    return Response.json(
      { message: "X-Ray generation is paused. Resume it from the queue." },
      { status: 409 },
    )
  }
  if (getJobAbortIntent(job.uuid)) {
    return Response.json(
      {
        message:
          "X-Ray generation is finishing a pause or cancellation. Try again in a moment.",
      },
      { status: 409 },
    )
  }

  return new Response(null, { status: 204 })
})
