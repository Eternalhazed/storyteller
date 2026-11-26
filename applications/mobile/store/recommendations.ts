import {
  GENERAL_SUBJECTS,
  MAX_SUBJECT_PICKS,
  uniqueSubjects,
  withoutSubjects,
} from "@storyteller/web/src/recommendations/subjects"
import {
  type PickSeries,
  type PickWork,
  type RoundStage,
  type SeriesLength,
  normalizeSeriesLengths,
} from "@storyteller/web/src/recommendations/types"

import { requestPickerHref } from "./requestNavigation"
import { type UUID } from "@/uuid"

export const ROUND_PROGRESS_STEPS = [
  { stage: null, title: "Reading your history" },
  { stage: "finding", title: "Finding books" },
  { stage: "verifying", title: "Checking the catalog" },
  { stage: "ranking", title: "Ranking your picks" },
] as const

export function stageLabel(stage: RoundStage | null) {
  const step = ROUND_PROGRESS_STEPS.find((item) => item.stage === stage)
  return `${(step ?? ROUND_PROGRESS_STEPS[0]).title}…`
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

export function toggleSeriesLength(
  current: SeriesLength[],
  length: SeriesLength | "any",
): SeriesLength[] {
  if (length === "any") return []
  return normalizeSeriesLengths(
    current.includes(length)
      ? current.filter((value) => value !== length)
      : [...current, length],
  )
}

export function subjectChoices(
  profile: readonly string[],
  custom: readonly string[],
) {
  return uniqueSubjects([...profile, ...GENERAL_SUBJECTS, ...custom])
}

export function toggleSubject(current: string[], subject: string): string[] {
  const [name] = uniqueSubjects([subject])
  if (!name) return current
  const remaining = withoutSubjects(current, [name])
  if (remaining.length < current.length) return remaining
  return current.length < MAX_SUBJECT_PICKS ? [...current, name] : current
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
