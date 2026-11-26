import { type Selectable, type Updateable, sql } from "kysely"

import {
  MAX_SUBJECT_PICKS,
  uniqueSubjects,
  withoutSubjects,
} from "@/recommendations/subjects"
import {
  DEFAULT_PREFERENCES,
  type Evidence,
  type PickSeries,
  type PickState,
  type PickView,
  type PickWork,
  type RecommendationPreferences,
  type RoundKind,
  type RoundStage,
  type RoundTrigger,
  type Section,
  normalizeSeriesLengths,
} from "@/recommendations/types"
import { type UUID } from "@/uuid"

import { sqlNow } from "./bookRequests"
import { db } from "./connection"
import { type DB } from "./schema"

export type RoundRow = Selectable<DB["recommendationRound"]>
export type PickRow = Selectable<DB["recommendation"]>
export type ReaderRow = Selectable<DB["recommendationReader"]>

/** A reader's row, created the first time they use recommendations. */
export async function ensureReader(userId: UUID): Promise<ReaderRow> {
  await db
    .insertInto("recommendationReader")
    .values({ userId })
    .onConflict((oc) => oc.column("userId").doNothing())
    .execute()
  return await db
    .selectFrom("recommendationReader")
    .selectAll()
    .where("userId", "=", userId)
    .executeTakeFirstOrThrow()
}

export async function getReader(userId: UUID): Promise<ReaderRow | null> {
  return (
    (await db
      .selectFrom("recommendationReader")
      .selectAll()
      .where("userId", "=", userId)
      .executeTakeFirst()) ?? null
  )
}

export async function getReaders(): Promise<ReaderRow[]> {
  return await db
    .selectFrom("recommendationReader")
    .selectAll()
    .orderBy("userId")
    .execute()
}

export async function updateReader(
  userId: UUID,
  patch: Omit<Updateable<DB["recommendationReader"]>, "userId" | "prefs">,
): Promise<void> {
  await db
    .updateTable("recommendationReader")
    .set({ ...patch, updatedAt: sqlNow() })
    .where("userId", "=", userId)
    .execute()
}

export function preferencesOf(
  reader: Pick<ReaderRow, "prefs"> | null,
): RecommendationPreferences {
  const prefs = { ...DEFAULT_PREFERENCES, ...reader?.prefs }
  const avoidSubjects = uniqueSubjects(prefs.avoidSubjects).slice(
    0,
    MAX_SUBJECT_PICKS,
  )
  return {
    ...prefs,
    seriesLength: normalizeSeriesLengths(prefs.seriesLength),
    favorSubjects: withoutSubjects(
      uniqueSubjects(prefs.favorSubjects),
      avoidSubjects,
    ).slice(0, MAX_SUBJECT_PICKS),
    avoidSubjects,
  }
}

export async function savePreferences(
  userId: UUID,
  prefs: RecommendationPreferences,
): Promise<void> {
  await ensureReader(userId)
  await db
    .updateTable("recommendationReader")
    .set({ prefs: JSON.stringify(prefs), updatedAt: sqlNow() })
    .where("userId", "=", userId)
    .execute()
}

export async function createRound(round: {
  userId: UUID
  trigger: RoundTrigger
  kind: RoundKind
  input: object
}): Promise<RoundRow> {
  return await db
    .insertInto("recommendationRound")
    .values({
      userId: round.userId,
      trigger: round.trigger,
      kind: round.kind,
      input: JSON.stringify(round.input),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function getRound(uuid: UUID): Promise<RoundRow | null> {
  return (
    (await db
      .selectFrom("recommendationRound")
      .selectAll()
      .where("uuid", "=", uuid)
      .executeTakeFirst()) ?? null
  )
}

export async function getRunningRound(userId: UUID): Promise<RoundRow | null> {
  return (
    (await db
      .selectFrom("recommendationRound")
      .selectAll()
      .where("userId", "=", userId)
      .where("status", "=", "running")
      .orderBy("createdAt", "desc")
      .executeTakeFirst()) ?? null
  )
}

export async function getRunningRounds(): Promise<RoundRow[]> {
  return await db
    .selectFrom("recommendationRound")
    .selectAll()
    .where("status", "=", "running")
    .execute()
}

export async function setRoundStage(
  uuid: UUID,
  stage: RoundStage,
): Promise<void> {
  await db
    .updateTable("recommendationRound")
    .set({ stage })
    .where("uuid", "=", uuid)
    .execute()
}

export async function failRound(uuid: UUID, error: string): Promise<void> {
  await db
    .updateTable("recommendationRound")
    .set({ status: "failed", error, finishedAt: sqlNow() })
    .where("uuid", "=", uuid)
    .execute()
}

/** Rounds of a reader, newest first. */
export async function getRounds(
  userId: UUID,
  options: { status?: RoundRow["status"]; limit?: number } = {},
): Promise<RoundRow[]> {
  return await db
    .selectFrom("recommendationRound")
    .selectAll()
    .where("userId", "=", userId)
    .$if(!!options.status, (qb) =>
      qb.where("status", "=", options.status ?? "done"),
    )
    .orderBy("createdAt", "desc")
    .orderBy(sql`rowid`, "desc")
    .$if(!!options.limit, (qb) => qb.limit(options.limit ?? 0))
    .execute()
}

export type NewPick = {
  workKey: string
  workIdentity: string
  work: PickWork
  section: Section
  rank: number
  fitScore: number | null
  adjustedScore: number | null
  pill: PickView["pill"]
  label: string | null
  note: string | null
  reason: string
  why: string
  evidence: Evidence[]
  series: PickSeries | null
  anchorTitle: string | null
}

/**
 * Finish a round: its picks and the round's own record land together, so a
 * reader never sees half a round.
 */
export async function completeRound(
  uuid: UUID,
  userId: UUID,
  picks: NewPick[],
  usage: {
    model: string | null
    inputTokens: number
    outputTokens: number
    cacheWriteTokens: number
    cacheReadTokens: number
    costMicroUsd: number
  },
): Promise<void> {
  await db.transaction().execute(async (tr) => {
    for (const pick of picks) {
      await tr
        .insertInto("recommendation")
        .values({
          roundUuid: uuid,
          userId,
          workKey: pick.workKey,
          workIdentity: pick.workIdentity,
          work: JSON.stringify(pick.work),
          section: pick.section,
          rank: pick.rank,
          fitScore: pick.fitScore,
          adjustedScore: pick.adjustedScore,
          pill: pick.pill,
          label: pick.label,
          note: pick.note,
          reason: pick.reason,
          why: pick.why,
          evidence: JSON.stringify(pick.evidence),
          series: pick.series ? JSON.stringify(pick.series) : null,
          anchorTitle: pick.anchorTitle,
        })
        .execute()
    }
    await tr
      .updateTable("recommendationRound")
      .set({
        status: "done",
        stage: null,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        cacheReadTokens: usage.cacheReadTokens,
        costMicrousd: usage.costMicroUsd,
        finishedAt: sqlNow(),
      })
      .where("uuid", "=", uuid)
      .execute()
  })
}

/** Record what a failed round spent, so the budget counts it. */
export async function recordRoundCost(
  uuid: UUID,
  usage: {
    model: string
    costMicroUsd: number
    inputTokens: number
    outputTokens: number
  },
): Promise<void> {
  await db
    .updateTable("recommendationRound")
    .set({
      model: usage.model,
      costMicrousd: usage.costMicroUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
    .where("uuid", "=", uuid)
    .execute()
}

export async function getPicksOfRounds(roundUuids: UUID[]): Promise<PickRow[]> {
  if (!roundUuids.length) return []
  return await db
    .selectFrom("recommendation")
    .selectAll()
    .where("roundUuid", "in", roundUuids)
    .orderBy("rank", "asc")
    .execute()
}

export async function getPick(
  userId: UUID,
  uuid: UUID,
): Promise<PickRow | null> {
  return (
    (await db
      .selectFrom("recommendation")
      .selectAll()
      .where("uuid", "=", uuid)
      .where("userId", "=", userId)
      .executeTakeFirst()) ?? null
  )
}

/** Every pick a reader was ever shown, newest first. */
export async function getAllPicks(userId: UUID): Promise<PickRow[]> {
  return await db
    .selectFrom("recommendation")
    .selectAll()
    .where("userId", "=", userId)
    .orderBy("createdAt", "desc")
    .orderBy(sql`rowid`, "desc")
    .execute()
}

export async function updatePick(
  uuid: UUID,
  patch: {
    state?: PickState
    stateReason?: string | null
    restedUntil?: string | null
    note?: string | null
    notifiedAt?: string | null
  },
): Promise<void> {
  await db
    .updateTable("recommendation")
    .set({
      ...patch,
      ...(patch.state ? { stateAt: sqlNow() } : {}),
    })
    .where("uuid", "=", uuid)
    .execute()
}

/** Add picks to a finished round (the daily new-in-series check). */
export async function addPicksToRound(
  roundUuid: UUID,
  userId: UUID,
  picks: NewPick[],
): Promise<PickRow[]> {
  const rows: PickRow[] = []
  for (const pick of picks) {
    rows.push(
      await db
        .insertInto("recommendation")
        .values({
          roundUuid,
          userId,
          workKey: pick.workKey,
          workIdentity: pick.workIdentity,
          work: JSON.stringify(pick.work),
          section: pick.section,
          rank: pick.rank,
          fitScore: pick.fitScore,
          adjustedScore: pick.adjustedScore,
          pill: pick.pill,
          label: pick.label,
          note: pick.note,
          reason: pick.reason,
          why: pick.why,
          evidence: JSON.stringify(pick.evidence),
          series: pick.series ? JSON.stringify(pick.series) : null,
          anchorTitle: pick.anchorTitle,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    )
  }
  return rows
}

/** Spend on model calls since a time (all readers: the budget is the server's). */
export async function spentMicroUsdSince(since: string): Promise<number> {
  const row = await db
    .selectFrom((eb) =>
      eb
        .selectFrom("recommendationRound")
        .select("costMicrousd")
        .where("createdAt", ">=", since)
        .unionAll(
          eb
            .selectFrom("helperTurn")
            .select("costMicrousd")
            .where("createdAt", ">=", since),
        )
        .as("modelCalls"),
    )
    .select((eb) => eb.fn.sum<number>("costMicrousd").as("spent"))
    .executeTakeFirst()
  return row?.spent ?? 0
}
