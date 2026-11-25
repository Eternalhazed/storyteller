import {
  type PickSeries,
  type PickWork,
  type RoundStage,
} from "@storyteller/web/src/recommendations/types"

import { requestPickerHref } from "./requestNavigation"
import { type UUID } from "@/uuid"

const STAGE_LABELS: Record<RoundStage, string> = {
  finding: "Finding books…",
  verifying: "Checking the catalog…",
  ranking: "Ranking your picks…",
}

export function stageLabel(stage: RoundStage | null) {
  return stage ? STAGE_LABELS[stage] : "Starting your picks…"
}

export function recommendationLength({
  runtimeMinutes,
  pages,
}: Pick<PickWork, "runtimeMinutes" | "pages">) {
  const parts = []
  if (runtimeMinutes && runtimeMinutes > 0) {
    const minutes = Math.round(runtimeMinutes)
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    parts.push(
      [hours ? `${hours} h` : null, rest || !hours ? `${rest} min` : null]
        .filter(Boolean)
        .join(" "),
    )
  }
  if (pages && pages > 0)
    parts.push(`${pages} ${pages === 1 ? "page" : "pages"}`)
  return parts.join(" · ")
}

export function seriesLine(series: PickSeries) {
  const { name, position, books, latestReleaseYear } = series
  const order =
    position === null
      ? books
        ? `${books} ${books === 1 ? "book" : "books"}`
        : null
      : `Book ${position}${books && books >= position ? ` of ${books}` : ""}`
  return [
    name,
    order,
    latestReleaseYear ? `Latest: ${latestReleaseYear}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

export function recommendationsHref(serverUuid?: UUID) {
  return { pathname: "/recommendations" as const, params: { serverUuid } }
}

export function recommendationPickHref(serverUuid: UUID, uuid: UUID) {
  return {
    pathname: "/recommendations/pick/[uuid]" as const,
    params: { serverUuid, uuid },
  }
}

export function resolvedWorkHref(
  serverUuid: UUID,
  work: PickWork,
  recommendationUuid?: UUID,
) {
  return requestPickerHref(serverUuid, {
    kind: "title",
    work,
    input: {
      text: work.title,
      ...(recommendationUuid ? { recommendationUuid } : {}),
    },
    resolved: true,
  })
}

export function subjectList(text: string) {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ]
}

/** One title per line: titles may contain commas ("The Lion, the Witch…"). */
export function titleList(text: string) {
  return [
    ...new Set(
      text
        .split("\n")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ]
}
