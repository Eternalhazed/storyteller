import { db } from "@/database/connection"
import {
  type PickRow,
  type RoundRow,
  getAllPicks,
  getRounds,
  getRunningRound,
  spentMicroUsdSince,
} from "@/database/recommendations"
import { utcTimestamp } from "@/requests/http"
import { type UUID } from "@/uuid"

import { type AiConfig } from "./ai"
import { alsoKnownAs } from "./candidates"
import { sqlTime } from "./clock"
import { type ReaderData, isColdStart, isRead } from "./reader"
import {
  type EarlierRoundView,
  type PickOutcome,
  type PickView,
  type RecommendationHistoryView,
  type RecommendationsView,
  type RoundView,
  SECTION_TITLES,
  type Section,
  type SectionStats,
  type SectionView,
} from "./types"

export const MANUAL_REFRESHES_PER_DAY = 3

export function toRoundView(round: RoundRow): RoundView {
  return {
    uuid: round.uuid,
    trigger: round.trigger,
    kind: round.kind,
    status: round.status,
    stage: round.stage,
    error: round.error,
    createdAt: utcTimestamp(round.createdAt),
    finishedAt: round.finishedAt && utcTimestamp(round.finishedAt),
  }
}

export function toPickView(pick: PickRow): PickView {
  return {
    uuid: pick.uuid,
    roundUuid: pick.roundUuid,
    section: pick.section,
    work: pick.work,
    reason: pick.reason,
    why: pick.why,
    evidence: pick.evidence,
    label: pick.label,
    pill: pick.pill,
    note: pick.note,
    series: pick.series,
    anchorTitle: pick.anchorTitle,
    state: pick.state,
    requestUuid: pick.requestUuid,
  }
}

/** Gone from view since the round: owned now, asked for, or read. */
export function settled(pick: PickRow, data: ReaderData): boolean {
  return pickNames(pick).some((name) => {
    if (data.requested.has(name)) return true
    const book = data.byIdentity.get(name)
    return !!book && (book.inLibrary || isRead(book))
  })
}

function pickNames(pick: PickRow): string[] {
  return [pick.workIdentity, ...alsoKnownAs(pick.work)]
}

function monthStart(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`
}

function dayStart(): string {
  return `${new Date().toISOString().slice(0, 10)} 00:00:00`
}

export async function budgetSpent(ai: AiConfig | null): Promise<boolean> {
  if (!ai) return false
  return (
    (await spentMicroUsdSince(monthStart())) >= ai.monthlyBudgetUsd * 1_000_000
  )
}

export async function refreshesUsedToday(userId: UUID): Promise<number> {
  const row = await db
    .selectFrom("recommendationRound")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("userId", "=", userId)
    .where("trigger", "=", "refresh")
    .where("status", "in", ["done", "running"])
    .where("createdAt", ">=", dayStart())
    .executeTakeFirst()
  return row?.count ?? 0
}

/** The rounds whose picks are current: the newest full round, plus newer asked/finished rounds. */
export function currentRounds(rounds: RoundRow[]): RoundRow[] {
  const done = rounds.filter((round) => round.status === "done")
  const full = done.find(
    (round) =>
      round.kind === "full" &&
      round.trigger !== "tune" &&
      round.trigger !== "wish",
  )
  const after = (round: RoundRow) => !full || round.createdAt >= full.createdAt
  const asked = done.find(
    (round) =>
      (round.trigger === "tune" || round.trigger === "wish") && after(round),
  )
  const finished = done.find(
    (round) => round.kind === "anchored" && after(round),
  )
  return [full, asked, finished].filter((round): round is RoundRow => !!round)
}

function interleave(lists: PickView[][], limit: number): PickView[] {
  const out: PickView[] = []
  for (let index = 0; out.length < limit; index++) {
    let added = false
    for (const list of lists) {
      const item = list[index]
      if (item && out.length < limit) {
        out.push(item)
        added = true
      }
    }
    if (!added) break
  }
  return out
}

export async function buildRecommendationsView(
  userId: UUID,
  data: ReaderData,
  ai: AiConfig | null,
): Promise<RecommendationsView> {
  const rounds = await getRounds(userId, { limit: 40 })
  const current = currentRounds(rounds)
  const currentIds = new Set(current.map((round) => round.uuid))
  const picks = await getAllPicks(userId)
  // What the reader did with a book holds for every round it appears in.
  const now = sqlTime()
  const handled = new Set(
    picks
      .filter(
        (pick) =>
          pick.state === "saved" ||
          pick.state === "requested" ||
          pick.state === "not_for_me" ||
          pick.state === "already_read" ||
          ((pick.state === "not_now" || pick.state === "not_found") &&
            !!pick.restedUntil &&
            pick.restedUntil > now),
      )
      .map((pick) => pick.workIdentity),
  )
  const live = picks.filter(
    (pick) =>
      currentIds.has(pick.roundUuid) &&
      pick.state === "new" &&
      !handled.has(pick.workIdentity) &&
      !settled(pick, data),
  )

  const sectionOrder: Section[] = [
    "asked",
    "finished",
    "series",
    "lists",
    "discover",
  ]
  const sections: SectionView[] = []
  const seen = new Set<string>()
  for (const section of sectionOrder) {
    const inSection = live
      .filter((pick) => pick.section === section)
      .sort((a, b) => a.rank - b.rank)
      .filter((pick) => {
        // Shown in an earlier section, or another edition of one shown.
        const names = pickNames(pick)
        if (names.some((name) => seen.has(name))) return false
        for (const name of names) seen.add(name)
        return true
      })
    if (!inSection.length) continue
    const anchor = inSection[0]?.anchorTitle
    sections.push({
      section,
      title:
        section === "finished" && anchor
          ? `${SECTION_TITLES.finished} ${anchor}`
          : SECTION_TITLES[section],
      picks: inSection.map(toPickView),
    })
  }

  const top = sections.filter(
    (s) => s.section === "asked" || s.section === "finished",
  )
  const standing = sections.filter((s) => !top.includes(s))
  const lead = top.flatMap((s) => s.picks.slice(0, 2))
  const rest = interleave(
    [...standing.map((s) => s.picks), ...top.map((s) => s.picks.slice(2))],
    8,
  )
  const forYou = [...lead, ...rest].slice(0, 8)

  const savedSeen = new Set<string>()
  const saved = picks
    .filter((pick) => pick.state === "saved" && !settled(pick, data))
    .filter((pick) => {
      if (savedSeen.has(pick.workIdentity)) return false
      savedSeen.add(pick.workIdentity)
      return true
    })
    .map(toPickView)

  const running = await getRunningRound(userId)
  const full = current.find(
    (round) =>
      round.kind === "full" &&
      round.trigger !== "tune" &&
      round.trigger !== "wish",
  )
  return {
    round: full ? toRoundView(full) : null,
    running: running ? toRoundView(running) : null,
    failed:
      rounds[0]?.status === "failed" &&
      ["tune", "wish", "refresh", "finished"].includes(rounds[0].trigger)
        ? toRoundView(rounds[0])
        : null,
    sections,
    forYou,
    saved,
    coldStart:
      isColdStart(data) && !rounds.some((round) => round.status === "done"),
    budgetPaused: await budgetSpent(ai),
    refreshesLeft: Math.max(
      0,
      MANUAL_REFRESHES_PER_DAY - (await refreshesUsedToday(userId)),
    ),
  }
}

async function outcomes(
  userId: UUID,
  picks: PickRow[],
): Promise<Map<UUID, { outcome: PickOutcome; rating: number | null }>> {
  const requestUuids = picks.flatMap((pick) =>
    pick.requestUuid ? [pick.requestUuid] : [],
  )
  const requests = requestUuids.length
    ? await db
        .selectFrom("bookRequest")
        .leftJoin("bookToStatus", (join) =>
          join
            .onRef("bookToStatus.bookUuid", "=", "bookRequest.bookUuid")
            .on("bookToStatus.userId", "=", userId),
        )
        .leftJoin("status", "status.uuid", "bookToStatus.statusUuid")
        .leftJoin("userBookRating", (join) =>
          join
            .onRef("userBookRating.bookUuid", "=", "bookRequest.bookUuid")
            .on("userBookRating.userId", "=", userId),
        )
        .select([
          "bookRequest.uuid",
          "status.name as statusName",
          "userBookRating.rating",
        ])
        .where("bookRequest.uuid", "in", requestUuids)
        .where("bookRequest.userId", "=", userId)
        .execute()
    : []
  const byRequest = new Map(requests.map((row) => [row.uuid, row]))
  const out = new Map<UUID, { outcome: PickOutcome; rating: number | null }>()
  for (const pick of picks) {
    const request = pick.requestUuid
      ? byRequest.get(pick.requestUuid)
      : undefined
    let outcome: PickOutcome = null
    let rating: number | null = null
    if (request) {
      rating = request.rating ?? null
      outcome =
        rating != null
          ? "rated"
          : request.statusName?.toLowerCase() === "read"
            ? "finished"
            : "requested"
    } else if (pick.state === "not_for_me") outcome = "turned_down"
    else if (pick.state === "not_found") outcome = "not_found"
    else if (pick.state === "saved") outcome = "saved"
    else if (pick.state === "already_read") outcome = "finished"
    out.set(pick.uuid, { outcome, rating })
  }
  return out
}

export async function buildHistoryView(
  userId: UUID,
): Promise<RecommendationHistoryView> {
  const rounds = await getRounds(userId, { status: "done", limit: 20 })
  const picks = await getAllPicks(userId)
  const roundIds = new Set(rounds.map((round) => round.uuid))
  const inRounds = picks.filter((pick) => roundIds.has(pick.roundUuid))
  const results = await outcomes(userId, picks)

  const views: EarlierRoundView[] = rounds.map((round) => ({
    ...toRoundView(round),
    picks: inRounds
      .filter((pick) => pick.roundUuid === round.uuid)
      .sort((a, b) => a.rank - b.rank)
      .map((pick) => ({
        ...toPickView(pick),
        ...(results.get(pick.uuid) ?? { outcome: null, rating: null }),
      })),
  }))

  const stats = new Map<Section, SectionStats>()
  for (const pick of picks) {
    const entry = stats.get(pick.section) ?? {
      section: pick.section,
      shown: 0,
      requested: 0,
      finished: 0,
      ratedHigh: 0,
      notForMe: 0,
    }
    const result = results.get(pick.uuid)
    entry.shown++
    if (pick.requestUuid) entry.requested++
    if (result?.outcome === "finished" || result?.outcome === "rated")
      entry.finished++
    if ((result?.rating ?? 0) >= 4) entry.ratedHigh++
    if (pick.state === "not_for_me") entry.notForMe++
    stats.set(pick.section, entry)
  }
  return { rounds: views, stats: [...stats.values()] }
}
