// oxlint-disable storyteller/no-tmpdir
/**
 * Backtest for recommendation rounds, run locally against a copy of one
 * reader's Goodreads export. Never commit its database or its results.
 *
 *   STORYTELLER_TEST_DB=1 STORYTELLER_SECRET_KEY=<any> ANTHROPIC_API_KEY=<key> \
 *   STORYTELLER_SKIP_STARTUP_BACKUP=true \
 *     npx tsx scripts/recommendation-backtest.ts --goodreads export.csv \
 *     --db /tmp/backtest.db --out /tmp/report.json [--runs 30] \
 *     [--model claude-sonnet-5-5]
 *
 * For each of the reader's last `runs` books rated 4–5★, history is cut the
 * day before the earlier of its "date added" and "date read" (books with
 * neither are skipped), one round runs as of that day, and the book counts
 * as found when it (or its series entry) is among the top 10 picks.
 * Catalog answers are cached in the database, so later runs are cheap.
 */
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"

import Db from "better-sqlite3"

import { getCatalog } from "@/catalog"
import { workIdentity } from "@/catalog/normalize"
import { replaceDatabase } from "@/database/connection"
import { createKyselyDb } from "@/database/factory"
import { migrate } from "@/database/migrate"
import {
  createImportJob,
  getHistoryItems,
  getImportJob,
} from "@/database/readingHistory"
import { getPicksOfRounds, getRounds } from "@/database/recommendations"
import { getSettings, updateSettings } from "@/database/settings"
import { runHistoryImport } from "@/history/importer"
import { parseGoodreads } from "@/history/parsers"
import { entryPoint } from "@/recommendations/candidates"
import { setReferenceDate } from "@/recommendations/clock"
import { isRead, loadReaderData } from "@/recommendations/reader"
import { drainRounds, startRound } from "@/recommendations/rounds"
import { DEFAULT_PREFERENCES } from "@/recommendations/types"
import { type UUID } from "@/uuid"

const { values } = parseArgs({
  options: {
    goodreads: { type: "string" },
    db: { type: "string" },
    runs: { type: "string", default: "30" },
    model: { type: "string", default: "claude-sonnet-5-5" },
    out: { type: "string", default: "backtest-report.json" },
  },
})

function dayBefore(date: string): string {
  return new Date(Date.parse(date.slice(0, 10)) - 86_400_000)
    .toISOString()
    .slice(0, 10)
}

async function setup(): Promise<UUID> {
  if (!values.goodreads || !values.db) {
    throw new Error("Pass --goodreads <export.csv> and --db <file>")
  }
  const key = process.env["ANTHROPIC_API_KEY"]
  if (!key) throw new Error("Set ANTHROPIC_API_KEY")
  const fresh = !existsSync(values.db)
  const sqlite = new Db(values.db)
  sqlite.function("uuid", () => randomUUID())
  replaceDatabase(createKyselyDb(sqlite))
  await migrate()
  // A zero budget keeps the import from starting a round of its own.
  await updateSettings({
    ...(await getSettings()),
    xrayAnthropicApiKey: key,
    recommendationModel: values.model,
    recommendationMonthlyBudgetUsd: 0,
  })

  const existing = sqlite.prepare(`SELECT id FROM "user" LIMIT 1`).get() as
    | { id: UUID }
    | undefined
  if (existing && !fresh) return existing.id
  const permission = randomUUID()
  const userId = randomUUID()
  sqlite
    .prepare(`INSERT INTO user_permission (uuid, book_read) VALUES (?, 1)`)
    .run(permission)
  sqlite
    .prepare(
      `INSERT INTO "user" (id, user_permission_uuid, email) VALUES (?, ?, ?)`,
    )
    .run(userId, permission, "backtest@example.invalid")
  const items = parseGoodreads(readFileSync(values.goodreads, "utf-8"))
  const job = await createImportJob(userId, "goodreads", items)
  await runHistoryImport(job)
  const done = await getImportJob(userId, job.uuid)
  console.error(`Imported ${done?.total} rows, ${done?.matched} matched`)
  return userId
}

type Outcome = {
  title: string
  cut: string
  kind: "continuation" | "discovery"
  hit: boolean
  baselineHit: boolean
  alreadyRead: number
  notInCatalog: number
  wrongEntry: number
}

async function main() {
  const userId = await setup()
  const history = await getHistoryItems(userId, { sources: ["goodreads"] })
  const targets = history
    .filter((item) => item.matchStatus === "matched" && (item.rating ?? 0) >= 4)
    .filter((item) => item.finishedAt || item.addedAt)
    .sort((a, b) =>
      (b.finishedAt ?? b.addedAt ?? "").localeCompare(
        a.finishedAt ?? a.addedAt ?? "",
      ),
    )
    .slice(0, Number(values.runs))
  const catalog = getCatalog()
  const outcomes: Outcome[] = []

  for (const target of targets) {
    const [first] = [target.addedAt, target.finishedAt]
      .filter((d): d is string => !!d)
      .sort()
    const work = target.work
    if (!first || !work) continue
    const cut = dayBefore(first)
    setReferenceDate(cut)
    const data = await loadReaderData(userId, DEFAULT_PREFERENCES)
    const identity = workIdentity(work.title, work.authors)
    const seriesRef = work.series[0]
    const series = seriesRef
      ? (await catalog.getSeries([seriesRef.key])).get(seriesRef.key)
      : null
    const entry = series ? entryPoint(series, data) : null
    const wanted = new Set([identity])
    if (entry) wanted.add(workIdentity(entry.work.title, entry.work.authors))
    const continuation = !!series?.books.some((book) => {
      const known = data.byIdentity.get(
        workIdentity(book.work.title, book.work.authors),
      )
      return !!known && isRead(known)
    })

    const round = await startRound(userId, "refresh")
    await drainRounds()
    const finished = (await getRounds(userId)).find(
      (each) => each.uuid === round.uuid,
    )
    if (finished?.status !== "done") {
      console.error(`Round failed for ${target.title}: ${finished?.error}`)
      continue
    }
    const picks = (await getPicksOfRounds([round.uuid])).slice(0, 10)
    const works = await catalog.getWorks(picks.map((pick) => pick.workKey))
    let wrongEntry = 0
    for (const pick of picks) {
      const ref = pick.work.series
      const key = works.get(pick.workKey)?.series[0]?.key
      if (!ref || !key) continue
      const found = (await catalog.getSeries([key])).get(key)
      const start = found ? entryPoint(found, data) : null
      if (start && ref.position != null && ref.position > start.position)
        wrongEntry++
    }

    // Baseline: the newest unread books by the reader's best-rated authors.
    const authors = [
      ...new Set(
        data.books
          .filter((book) => isRead(book) && (book.rating ?? 0) >= 4)
          .map((book) => book.authors[0])
          .filter((name): name is string => !!name),
      ),
    ].slice(0, 5)
    const baseline: string[] = []
    for (const author of authors) {
      for (const work of await catalog.worksByAuthor(author, 10)) {
        const id = workIdentity(work.title, work.authors)
        const known = data.byIdentity.get(id)
        if (known && isRead(known)) continue
        if (work.releaseDate && work.releaseDate > cut) continue
        baseline.push(id)
      }
    }

    const outcome: Outcome = {
      title: target.title,
      cut,
      kind: continuation ? "continuation" : "discovery",
      hit: picks.some((pick) => wanted.has(pick.workIdentity)),
      baselineHit: baseline.slice(0, 10).some((id) => wanted.has(id)),
      alreadyRead: picks.filter((pick) => {
        const known = data.byIdentity.get(pick.workIdentity)
        return !!known && isRead(known)
      }).length,
      notInCatalog: picks.filter((pick) => !works.has(pick.workKey)).length,
      wrongEntry,
    }
    outcomes.push(outcome)
    console.error(`${outcome.hit ? "hit " : "miss"} ${target.title} (${cut})`)
  }
  setReferenceDate(null)

  const rate = (kind: Outcome["kind"], field: "hit" | "baselineHit") => {
    const rows = outcomes.filter((outcome) => outcome.kind === kind)
    return rows.length
      ? `${rows.filter((row) => row[field]).length}/${rows.length}`
      : "–"
  }
  const sum = (field: "alreadyRead" | "notInCatalog" | "wrongEntry") =>
    outcomes.reduce((total, outcome) => total + outcome[field], 0)
  const spent = (await getRounds(userId)).reduce(
    (total, each) => total + each.costMicrousd,
    0,
  )
  const report = JSON.stringify(
    {
      model: values.model,
      runs: outcomes.length,
      hitAt10: {
        continuation: rate("continuation", "hit"),
        discovery: rate("discovery", "hit"),
      },
      baselineAt10: {
        continuation: rate("continuation", "baselineHit"),
        discovery: rate("discovery", "baselineHit"),
      },
      mustBeZero: {
        alreadyRead: sum("alreadyRead"),
        notInCatalog: sum("notInCatalog"),
        wrongEntry: sum("wrongEntry"),
      },
      costUsd: spent / 1_000_000,
      outcomes,
    },
    null,
    2,
  )
  // The server's logger writes to stdout, so the report goes to a file.
  writeFileSync(values.out, report + "\n")
  console.error(`Report written to ${values.out}`)
}

await main()
// Open HTTP keep-alive sockets and timers would keep the script running.
process.exit(0)
