import { NextResponse } from "next/server"
import { z } from "zod"

import {
  type ImportJob,
  countHistorySourceItems,
  getImportJobsForUser,
} from "@/database/readingHistory"
import { toIsoDateTimeString } from "@/dates"
import { type UUID } from "@/uuid"

import {
  HISTORY_SOURCES,
  type HistoryItemSource,
  type HistorySourceSummary,
  type ImportJobView,
} from "./types"

export const HistorySourceSchema = z.enum(HISTORY_SOURCES)
export const HistoryItemSourceSchema = z.enum([...HISTORY_SOURCES, "manual"])
export const HistoryUuidSchema = z.uuid().transform((value) => value as UUID)

export function historyError(message: string, code: string, status: number) {
  return NextResponse.json({ message, code }, { status })
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

export function toImportJobView(job: ImportJob): ImportJobView {
  const {
    uuid,
    source,
    status,
    total,
    processed,
    matched,
    unmatched,
    error,
    createdAt,
    finishedAt,
  } = job
  return {
    uuid,
    source,
    status,
    total,
    processed,
    matched,
    unmatched,
    error,
    createdAt: toIsoDateTimeString(createdAt) ?? createdAt,
    finishedAt: toIsoDateTimeString(finishedAt),
  }
}

export async function getHistorySummaries(
  userId: UUID,
): Promise<HistorySourceSummary[]> {
  const [counts, jobs] = await Promise.all([
    countHistorySourceItems(userId),
    getImportJobsForUser(userId),
  ])
  const summaries = new Map<HistoryItemSource, HistorySourceSummary>()
  for (const source of [...HISTORY_SOURCES, "manual"] as const) {
    summaries.set(source, {
      source,
      items: 0,
      matched: 0,
      unmatched: 0,
      lastImport: null,
    })
  }
  for (const { source, matchStatus, total } of counts) {
    const summary = summaries.get(source)
    if (!summary) continue
    summary.items += total
    if (matchStatus === "matched") summary.matched += total
    if (matchStatus === "unmatched") summary.unmatched += total
  }
  for (const job of jobs) {
    const summary = summaries.get(job.source)
    if (summary && !summary.lastImport)
      summary.lastImport = toImportJobView(job)
  }
  return [...summaries.values()]
}
