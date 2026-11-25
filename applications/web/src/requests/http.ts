import { NextResponse } from "next/server"
import { z } from "zod"

import { isPresent } from "@/assets/library/deliver"
import { type BookRequest } from "@/database/bookRequests"
import { getBook } from "@/database/books"
import { getJob } from "@/database/jobs"
import { toIsoDateTimeString } from "@/dates"
import { logger } from "@/logging"
import { type UUID } from "@/uuid"

import { AdapterError } from "./adapter"
import { RequestError } from "./service"
import {
  type AlignStatus,
  type ChosenRelease,
  type ChosenWork,
  type FormatStatus,
  REQUEST_FORMATS,
  REQUEST_KINDS,
  type RequestKind,
} from "./types"

/** A UUID, typed as one. */
export const UuidSchema = z.uuid().transform((value) => value as UUID)

export const WorkSchema = z.object({
  title: z.string().trim().min(1),
  authors: z.array(z.string()).default([]),
  series: z
    .object({ name: z.string(), position: z.number().nullable() })
    .nullable()
    .optional(),
  altTitles: z.array(z.string()).optional(),
  language: z.string().nullable().optional(),
  ids: z.record(z.string(), z.string()).optional(),
}) satisfies z.ZodType<ChosenWork>

export const ReleaseRefSchema = z.object({
  source: z.string().min(1),
  id: z.string().min(1),
  kind: z.enum(REQUEST_FORMATS),
})

export const CreateRequestSchema = z.object({
  kind: z.enum(REQUEST_KINDS),
  input: z
    .object({
      seriesUuid: UuidSchema.nullable().optional(),
      seriesName: z.string().nullable().optional(),
      position: z.number().nullable().optional(),
      sourceBookUuid: UuidSchema.nullable().optional(),
      text: z.string().nullable().optional(),
      recommendationUuid: UuidSchema.nullable().optional(),
    })
    .default({}),
  work: WorkSchema,
  ebook: ReleaseRefSchema.nullable().optional(),
  audio: ReleaseRefSchema.nullable().optional(),
  bookUuid: UuidSchema.nullable().optional(),
})

export type FormatView = {
  status: FormatStatus
  /** 0 to 1. */
  progress: number
  release: ChosenRelease | null
  error: string | null
}

/** What a reader sees of their request; nothing about other readers. */
export type RequestView = {
  uuid: UUID
  kind: RequestKind
  work: ChosenWork
  bookUuid: UUID
  ebook: FormatView
  audio: FormatView
  sync: {
    status: AlignStatus
    /** 0 to 1 within the current stage, while syncing. */
    progress: number
    stage: string | null
  }
  /**
   * Everything asked for is in: every requested format is ready, and the
   * read-along too when the book has both formats. The app takes a complete
   * request off the Home card once the reader opens the book.
   */
  complete: boolean
  /** ISO 8601, UTC. */
  createdAt: string
  closedAt: string | null
}

async function isComplete(request: BookRequest): Promise<boolean> {
  const wanted = [request.ebookStatus, request.audioStatus].filter(
    (status) => status !== "none",
  )
  if (!wanted.every((status) => status === "ready")) return false
  if (request.alignStatus === "done") return true
  if (request.alignStatus !== "none") return false
  // nothing to sync unless the book holds both formats
  const book = await getBook(request.bookUuid)
  return !(isPresent(book?.ebook) && isPresent(book?.audiobook))
}

export async function toRequestView(
  request: BookRequest,
): Promise<RequestView> {
  const job = request.alignJobUuid ? await getJob(request.alignJobUuid) : null
  return {
    uuid: request.uuid,
    kind: request.kind,
    work: request.chosenWork,
    bookUuid: request.bookUuid,
    ebook: {
      status: request.ebookStatus,
      progress: request.ebookProgress,
      release: request.ebookRelease,
      error: request.ebookError,
    },
    audio: {
      status: request.audioStatus,
      progress: request.audioProgress,
      release: request.audioRelease,
      error: request.audioError,
    },
    sync: {
      status: request.alignStatus,
      progress: job?.progress ?? 0,
      stage: job?.stage ?? null,
    },
    complete: await isComplete(request),
    createdAt: utcTimestamp(request.createdAt),
    closedAt: request.closedAt && utcTimestamp(request.closedAt),
  }
}

/**
 * SQLite stores times as UTC text without a zone, which a client would read
 * as its own local time; send them as ISO 8601 with the zone instead.
 */
export function utcTimestamp(value: string): string {
  return toIsoDateTimeString(value) ?? value
}

/** Parse a JSON body, answering 400 with the reason when it does not fit. */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<
  { ok: true; data: z.output<T> } | { ok: false; response: Response }
> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Expected JSON" },
        { status: 400 },
      ),
    }
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: z.prettifyError(parsed.error) },
        { status: 400 },
      ),
    }
  }
  return { ok: true, data: parsed.data }
}

/** Turn a refusal into its answer; anything else is a server error. */
export function requestErrorResponse(error: unknown): Response {
  if (error instanceof RequestError) {
    return NextResponse.json(
      { message: error.message, code: error.code },
      { status: error.status },
    )
  }
  if (error instanceof AdapterError) {
    logger.warn({ msg: "Acquisition adapter failed", error: error.message })
    return NextResponse.json(
      { message: "The download service is not answering", code: "adapter" },
      { status: 502 },
    )
  }
  throw error
}

export const disabledResponse = () =>
  NextResponse.json(
    {
      message: "Book requests are not set up on this server",
      code: "disabled",
    },
    { status: 404 },
  )
