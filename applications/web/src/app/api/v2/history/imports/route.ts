import { Buffer } from "node:buffer"

import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { createImportJob } from "@/database/readingHistory"
import {
  HistorySourceSchema,
  historyError,
  toImportJobView,
} from "@/history/http"
import { runHistoryImport } from "@/history/importer"
import { parseKindle } from "@/history/kindle"
import { parseAudible, parseGoodreads } from "@/history/parsers"
import { type ParsedHistoryItem } from "@/history/types"
import { logger } from "@/logging"

const MAX_FILE = 50 * 1024 * 1024
const MAX_REQUEST = MAX_FILE + 64 * 1024
const MAX_SIZE_ERROR = "Reading history files must be 50 MB or smaller."

export const dynamic = "force-dynamic"

export const POST = withHasPermission("bookRead")(async (request) => {
  if (Number(request.headers.get("content-length")) > MAX_REQUEST) {
    return historyError(MAX_SIZE_ERROR, "file-too-large", 413)
  }
  const contentType = request.headers.get("content-type")
  if (
    !request.body ||
    !contentType?.toLowerCase().startsWith("multipart/form-data;")
  ) {
    return historyError(
      "Expected a multipart upload with a source and file.",
      "invalid-upload",
      400,
    )
  }

  let size = 0
  let form: FormData
  try {
    const body = request.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.byteLength
          if (size > MAX_REQUEST) {
            controller.error(new Error(MAX_SIZE_ERROR))
            return
          }
          controller.enqueue(chunk)
        },
      }),
    )
    form = await new Response(body, {
      headers: { "content-type": contentType },
    }).formData()
  } catch {
    return size > MAX_REQUEST
      ? historyError(MAX_SIZE_ERROR, "file-too-large", 413)
      : historyError(
          "The multipart upload could not be read.",
          "invalid-upload",
          400,
        )
  }

  const source = HistorySourceSchema.safeParse(form.get("source"))
  if (!source.success) {
    return historyError(
      "Choose Goodreads, Audible, or Kindle as the source.",
      "unknown-source",
      400,
    )
  }
  const file = form.get("file")
  if (!file || typeof file === "string" || !file.size) {
    return historyError(
      "Choose a non-empty reading history export file.",
      "missing-file",
      400,
    )
  }
  if (file.size > MAX_FILE)
    return historyError(MAX_SIZE_ERROR, "file-too-large", 413)

  let items: ParsedHistoryItem[]
  const now = new Date()
  try {
    switch (source.data) {
      case "goodreads":
        items = parseGoodreads(await file.text())
        break
      case "audible":
        items = parseAudible(await file.text(), now)
        break
      case "kindle":
        items = await parseKindle(Buffer.from(await file.arrayBuffer()), now)
        break
    }
  } catch (error) {
    return historyError(
      error instanceof Error
        ? error.message
        : "The history file could not be parsed.",
      "invalid-export",
      400,
    )
  }
  const job = await createImportJob(request.auth.user.id, source.data, items)
  void runHistoryImport(job).catch(() => {
    logger.error({
      msg: "Could not record reading history import failure",
      jobUuid: job.uuid,
    })
  })
  return NextResponse.json(toImportJobView(job), { status: 202 })
})
