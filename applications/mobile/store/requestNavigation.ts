import {
  type ChosenWork,
  type RequestFormat,
  type RequestInput,
} from "@storyteller/web/src/requests/types"

import { type UUID } from "@/uuid"

type NewRequestTarget =
  | {
      kind: "gap" | "successor" | "title"
      work: ChosenWork
      input: RequestInput
    }
  | {
      kind: "add_format"
      work: ChosenWork
      input: RequestInput
      bookUuid: UUID
      format: RequestFormat
    }

type ReplacementTarget = { requestUuid: UUID; format: RequestFormat }

export type RequestPickerTarget = NewRequestTarget | ReplacementTarget

export type RequestPickerParams = Record<string, string | undefined>

export function parseRequestUuid(value: unknown): UUID | undefined {
  if (
    typeof value === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
  ) {
    return value as UUID
  }
  return undefined
}

function parseAuthors(value: string | undefined): string[] {
  if (!value) return []
  try {
    const authors: unknown = JSON.parse(value)
    return Array.isArray(authors)
      ? authors.filter((author): author is string => typeof author === "string")
      : []
  } catch {
    return []
  }
}

export function parsePickerTarget(
  params: RequestPickerParams,
): RequestPickerTarget | null {
  const format = params["format"]
  const validFormat = format === "ebook" || format === "audio"
  const requestUuid = parseRequestUuid(params["requestUuid"])
  if (requestUuid && validFormat) return { requestUuid, format }

  const title = params["title"]
  const kind = params["kind"]
  if (typeof title !== "string" || !title.trim()) return null

  const name = params["seriesName"]
  const positionParam = params["position"]
  const position =
    positionParam && Number.isFinite(Number(positionParam))
      ? Number(positionParam)
      : null
  const work: ChosenWork = {
    title,
    authors: parseAuthors(params["authors"]),
    series: typeof name === "string" ? { name, position } : null,
    language:
      typeof params["language"] === "string" ? params["language"] : null,
  }
  const seriesUuid = parseRequestUuid(params["seriesUuid"])
  if (
    kind === "gap" &&
    seriesUuid &&
    typeof name === "string" &&
    position !== null
  ) {
    return { kind, work, input: { seriesUuid, seriesName: name, position } }
  }
  const sourceBookUuid = parseRequestUuid(params["sourceBookUuid"])
  if (kind === "successor" && seriesUuid && sourceBookUuid) {
    return { kind, work, input: { seriesUuid, sourceBookUuid } }
  }
  const bookUuid = parseRequestUuid(params["bookUuid"])
  if (kind === "add_format" && bookUuid && validFormat) {
    return {
      kind,
      work,
      input: seriesUuid ? { seriesUuid } : {},
      bookUuid,
      format,
    }
  }
  if (kind === "title") return { kind, work, input: { text: title } }
  return null
}

export function requestPickerHref(
  serverUuid: UUID,
  target: RequestPickerTarget,
) {
  const pathname = "/request/new" as const
  if ("requestUuid" in target)
    return { pathname, params: { serverUuid, ...target } }
  const { work, input } = target
  return {
    pathname,
    params: {
      serverUuid,
      kind: target.kind,
      title: work.title,
      authors: JSON.stringify(work.authors),
      language: work.language,
      seriesUuid: input.seriesUuid,
      seriesName: work.series?.name,
      position: work.series?.position,
      sourceBookUuid: input.sourceBookUuid,
      ...(target.kind === "add_format"
        ? { bookUuid: target.bookUuid, format: target.format }
        : {}),
    },
  }
}

export function requestListHref(serverUuid: UUID) {
  return { pathname: "/request" as const, params: { serverUuid } }
}

export function requestDetailHref(serverUuid: UUID, uuid: UUID) {
  return { pathname: "/request/[uuid]" as const, params: { serverUuid, uuid } }
}
