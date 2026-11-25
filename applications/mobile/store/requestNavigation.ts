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
      resolved?: boolean
    }
  | {
      kind: "add_format"
      work: ChosenWork
      input: RequestInput
      bookUuid: UUID
      format: RequestFormat
      resolved?: boolean
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

function parseIds(
  value: string | undefined,
): Record<string, string> | undefined {
  if (!value) return undefined
  try {
    const ids: unknown = JSON.parse(value)
    if (!ids || typeof ids !== "object" || Array.isArray(ids)) return undefined
    return Object.fromEntries(
      Object.entries(ids).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    )
  } catch {
    return undefined
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
  const ids = parseIds(params["ids"])
  const altTitles = parseAuthors(params["altTitles"])
  const recommendationUuid = parseRequestUuid(params["recommendationUuid"])
  const recommendationInput = recommendationUuid ? { recommendationUuid } : {}
  const resolved = params["resolved"] === "true"
  const work: ChosenWork = {
    title,
    authors: parseAuthors(params["authors"]),
    series: typeof name === "string" ? { name, position } : null,
    language:
      typeof params["language"] === "string" ? params["language"] : null,
    ...(ids ? { ids } : {}),
    ...(altTitles.length ? { altTitles } : {}),
  }
  const seriesUuid = parseRequestUuid(params["seriesUuid"])
  if (
    kind === "gap" &&
    seriesUuid &&
    typeof name === "string" &&
    position !== null
  ) {
    return {
      kind,
      work,
      input: { seriesUuid, seriesName: name, position, ...recommendationInput },
      resolved,
    }
  }
  const sourceBookUuid = parseRequestUuid(params["sourceBookUuid"])
  if (kind === "successor" && seriesUuid && sourceBookUuid) {
    return {
      kind,
      work,
      input: { seriesUuid, sourceBookUuid, ...recommendationInput },
      resolved,
    }
  }
  const bookUuid = parseRequestUuid(params["bookUuid"])
  if (kind === "add_format" && bookUuid && validFormat) {
    return {
      kind,
      work,
      input: { ...(seriesUuid ? { seriesUuid } : {}), ...recommendationInput },
      bookUuid,
      format,
      resolved,
    }
  }
  if (kind === "title")
    return {
      kind,
      work,
      input: { text: title, ...recommendationInput },
      resolved,
    }
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
      resolved: target.resolved ? "true" : undefined,
      recommendationUuid: input.recommendationUuid,
      ids: work.ids ? JSON.stringify(work.ids) : undefined,
      altTitles: work.altTitles ? JSON.stringify(work.altTitles) : undefined,
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
