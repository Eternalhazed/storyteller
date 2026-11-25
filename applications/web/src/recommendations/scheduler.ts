import { getCatalog } from "@/catalog"
import {
  type ReaderRow,
  addPicksToRound,
  getAllPicks,
  getReaders,
  getRounds,
  preferencesOf,
  updatePick,
  updateReader,
} from "@/database/recommendations"
import { logger } from "@/logging"
import { sendToReader } from "@/requests/push"
import { type UUID } from "@/uuid"

import { getAiConfig } from "./ai"
import { EvidenceBook, filterCandidates, seriesCandidates } from "./candidates"
import { sqlTime as sqlTimeAt } from "./clock"
import { buildProfile, loadReaderData } from "./reader"
import { recoverInterruptedRounds, startRound, toPickWork } from "./rounds"
import { budgetSpent } from "./views"

const TICK_MS = 10 * 60_000
const READER_SPACING_MS = 30 * 60_000

function sqlTime(date: Date): string {
  return sqlTimeAt(date.getTime())
}

/** The most recent Sunday 05:00 (server time) at or before `now`. */
export function weeklySlot(now: Date): Date {
  const slot = new Date(now)
  slot.setHours(5, 0, 0, 0)
  slot.setDate(slot.getDate() - slot.getDay())
  if (slot > now) slot.setDate(slot.getDate() - 7)
  return slot
}

/** Today's 04:00 (server time), or yesterday's before 04:00. */
export function dailySlot(now: Date): Date {
  const slot = new Date(now)
  slot.setHours(4, 0, 0, 0)
  if (slot > now) slot.setDate(slot.getDate() - 1)
  return slot
}

/**
 * New books in the reader's followed series since they last read it, found
 * by code alone. Each new book is added once to the current picks, and the
 * reader is told once if they want to be.
 */
export async function checkNewInSeries(
  userId: UUID,
  reader: ReaderRow,
): Promise<number> {
  const prefs = preferencesOf(reader)
  const full = (await getRounds(userId, { status: "done", limit: 20 })).find(
    (round) =>
      round.kind === "full" &&
      round.trigger !== "tune" &&
      round.trigger !== "wish",
  )
  if (!full) return 0 // the first round will show them
  const data = await loadReaderData(userId, prefs)
  const profile = buildProfile(data)
  const evidence = new EvidenceBook()
  const found = await seriesCandidates(profile, data, getCatalog(), evidence)
  const fresh = found.filter((candidate) => candidate.pill === "new")
  const { kept } = filterCandidates(fresh, {
    data,
    profile,
    avoidSubjects: prefs.avoidSubjects,
    restIgnored: false,
  })
  const shown = new Set(
    (await getAllPicks(userId)).map((pick) => pick.workIdentity),
  )
  const added = await addPicksToRound(
    full.uuid,
    userId,
    kept
      .filter((candidate) => !shown.has(candidate.identity))
      .flatMap((candidate) => {
        const series = candidate.series
        if (!series) return []
        const work = candidate.work
        return {
          workKey: work.key,
          workIdentity: candidate.identity,
          work: {
            ...toPickWork(work),
            series: { name: series.catalog.name, position: series.position },
          },
          section: "series" as const,
          rank: 0,
          fitScore: null,
          adjustedScore: null,
          pill: "new" as const,
          label: null,
          note: null,
          reason: `New in ${series.catalog.name}: book ${series.position}, out ${work.releaseDate}`,
          why: `${work.title} is book ${series.position} of ${series.catalog.name}, released after you last read the series.`,
          evidence: candidate.evidence,
          series: {
            name: series.catalog.name,
            position: series.position,
            books: series.catalog.books.length,
            latestReleaseYear: series.catalog.latestReleaseDate
              ? Number(series.catalog.latestReleaseDate.slice(0, 4))
              : null,
          },
          anchorTitle: null,
        }
      }),
  )
  if (prefs.notifyNewInSeries) {
    for (const pick of added) {
      await sendToReader(userId, {
        title: `New book in ${pick.series?.name ?? "your series"}: #${pick.series?.position ?? ""}`,
        body: pick.work.title,
        data: { recommendationUuid: pick.uuid },
        channel: "recommendations",
      })
      await updatePick(pick.uuid, { notifiedAt: sqlTime(new Date()) })
    }
  }
  return added.length
}

/** One pass: due finish windows, weekly rounds and the daily series check. */
export async function tick(now = new Date()): Promise<void> {
  const ai = await getAiConfig()
  if (!ai) return
  const paused = await budgetSpent(ai)
  const readers = await getReaders()
  const nowText = sqlTime(now)
  const weekly = weeklySlot(now)
  const daily = sqlTime(dailySlot(now))

  for (const [index, reader] of readers.entries()) {
    const userId = reader.userId
    try {
      if (reader.finishDueAt && reader.finishDueAt <= nowText) {
        const single = reader.finishCount === 1 && reader.finishBookUuid
        await updateReader(userId, {
          finishBookUuid: null,
          finishCount: 0,
          finishDueAt: null,
        })
        if (single && reader.finishBookUuid && !paused) {
          await startRound(userId, "finished", {
            anchorBookUuid: reader.finishBookUuid,
          })
        }
      }

      const slot = sqlTime(
        new Date(weekly.getTime() + index * READER_SPACING_MS),
      )
      if (!reader.lastWeeklyAt) {
        // A new reader waits for the next weekly slot.
        await updateReader(userId, { lastWeeklyAt: nowText })
      } else if (nowText >= slot && reader.lastWeeklyAt < slot) {
        await updateReader(userId, { lastWeeklyAt: nowText })
        if (!paused) await startRound(userId, "weekly")
      }

      if (!reader.seriesCheckedAt || reader.seriesCheckedAt < daily) {
        await updateReader(userId, { seriesCheckedAt: nowText })
        await checkNewInSeries(userId, reader)
      }
    } catch (error) {
      logger.warn({
        msg: "Recommendation scheduling failed for a reader",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var recommendationScheduler: NodeJS.Timeout | undefined
}

/** Started once at server start. */
export function startRecommendationScheduler(): void {
  if (globalThis.recommendationScheduler) return
  void (async () => {
    try {
      await recoverInterruptedRounds()
      await tick()
    } catch (error) {
      logger.error({
        msg: "Failed to start recommendation rounds",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })()
  globalThis.recommendationScheduler = setInterval(() => {
    tick().catch((error: unknown) => {
      logger.error({ msg: "Recommendation tick failed", error })
    })
  }, TICK_MS)
  globalThis.recommendationScheduler.unref()
}
