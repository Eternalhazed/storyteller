import { NextResponse } from "next/server"
import { z } from "zod"

import { type BookRequest } from "@/database/bookRequests"
import { getJob } from "@/database/jobs"
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
  createdAt: string
  closedAt: string | null
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
    createdAt: request.createdAt,
    closedAt: request.closedAt,
  }
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
