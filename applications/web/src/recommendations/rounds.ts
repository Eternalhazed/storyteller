import {
  type TokenUsage,
  addUsage,
  costMicroUsd,
  emptyUsage,
} from "@storyteller/xray"

import { getCatalog } from "@/catalog"
import { primarySeries, seriesFamily, workIdentity } from "@/catalog/normalize"
import { type CatalogWork } from "@/catalog/types"
import { getBook } from "@/database/books"
import {
  type NewPick,
  type RoundRow,
  completeRound,
  createRound,
  ensureReader,
  failRound,
  getAllPicks,
  getRound,
  getRounds,
  getRunningRound,
  getRunningRounds,
  preferencesOf,
  recordRoundCost,
  savePreferences,
  setRoundStage,
  updatePick,
} from "@/database/recommendations"
import { logger } from "@/logging"
import { sendToReader } from "@/requests/push"
import { type UUID } from "@/uuid"

import { type AiConfig, getAiConfig } from "./ai"
import {
  type Candidate,
  EvidenceBook,
  authorCandidates,
  filterCandidates,
  globalEvidence,
  listCandidates,
  placeInSeries,
  seriesCandidates,
  similarCandidates,
  verifyProposals,
} from "./candidates"
import { sqlTime } from "./clock"
import { type Brief, proposeBooks, scoreCandidates } from "./model"
import { type ReaderData, type ReaderProfile, rebuildProfile } from "./reader"
import { uniqueSubjects, withoutSubjects } from "./subjects"
import {
  type InterviewAnswers,
  type PickSeries,
  type PickWork,
  type RecommendationPreferences,
  type RoundKind,
  type RoundTrigger,
  type Section,
  normalizeSeriesLengths,
} from "./types"
import {
  applyDiversity,
  newDiversityState,
  preferencePenalty,
} from "./weighting"

/** What started a round, stored with it. */
export type RoundInput = {
  answers?: InterviewAnswers
  wish?: string
  anchorBookUuid?: UUID
  /** Set on the automatic retry of a round a restart interrupted. */
  retryOf?: UUID
}

/** Picks below this fit are not worth a card (the model writes no reason for them). */
const MIN_FIT = 50
/** Most candidates sent to one scoring call. */
const MAX_CANDIDATES = 45
const SECTION_LIMITS: Record<Section, number> = {
  asked: 8,
  finished: 4,
  series: 4,
  lists: 4,
  discover: 6,
}
const DAY_MS = 86_400_000

export class RoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RoundError"
  }
}

function kindOf(trigger: RoundTrigger): RoundKind {
  return trigger === "finished" ? "anchored" : "full"
}

declare global {
  // eslint-disable-next-line no-var
  var recommendationQueue:
    | { pending: UUID[]; running: Promise<void> | null }
    | undefined
}

function queue() {
  globalThis.recommendationQueue ??= { pending: [], running: null }
  return globalThis.recommendationQueue
}

/** Run queued rounds one at a time; on-demand rounds go to the front. */
function enqueue(uuid: UUID, front: boolean): Promise<void> {
  const state = queue()
  if (front) state.pending.unshift(uuid)
  else state.pending.push(uuid)
  state.running ??= (async () => {
    for (let next = state.pending.shift(); next; next = state.pending.shift()) {
      try {
        await runRound(next)
      } catch (error) {
        logger.error({
          msg: "Recommendation round crashed",
          round: next,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    state.running = null
  })()
  return state.running
}

/** Wait for every queued round (tests and the backtest). */
export async function drainRounds(): Promise<void> {
  while (queue().running) await queue().running
}

/**
 * Start a round for a reader. A repeat of a request that is still running
 * (a second tap) returns that round; an automatic round returns whatever is
 * running. A different request from the reader queues its own round, ahead
 * of automatic ones, so they see picks for what they asked.
 */
export async function startRound(
  userId: UUID,
  trigger: RoundTrigger,
  input: RoundInput = {},
): Promise<RoundRow> {
  await ensureReader(userId)
  const onDemand = ON_DEMAND.includes(trigger)
  if (!onDemand) {
    const running = await getRunningRound(userId)
    if (running) return running
  } else {
    const same = (await getRounds(userId, { status: "running" })).find(
      (round) =>
        round.trigger === trigger &&
        JSON.stringify(round.input) === JSON.stringify(input),
    )
    if (same) return same
  }
  const round = await createRound({
    userId,
    trigger,
    kind: kindOf(trigger),
    input,
  })
  void enqueue(round.uuid, onDemand)
  return round
}

const ON_DEMAND: RoundTrigger[] = [
  "tune",
  "wish",
  "refresh",
  "finished",
  "first",
]

/**
 * At server start: a round still running was cut off. Mark it failed and,
 * once, run it again; the reader keeps seeing the previous picks meanwhile.
 */
export async function recoverInterruptedRounds(): Promise<void> {
  for (const round of await getRunningRounds()) {
    await failRound(round.uuid, "Interrupted by a server restart")
    if (round.input.retryOf) continue
    const retry = await createRound({
      userId: round.userId,
      trigger: round.trigger,
      kind: round.kind,
      input: { ...round.input, retryOf: round.uuid },
    })
    void enqueue(retry.uuid, false)
  }
}

export function toPickWork(work: CatalogWork): PickWork {
  const series = primarySeries(work.series)
  return {
    title: work.title,
    authors: work.authors,
    series: series ? { name: series.name, position: series.position } : null,
    language: work.language,
    ids: { ...work.ids, catalog: work.key },
    key: work.key,
    coverUrl: work.coverUrl,
    releaseDate: work.releaseDate,
    runtimeMinutes: work.runtimeMinutes,
    pages: work.pages,
    narrators: work.narrators,
    description: work.description ? work.description.slice(0, 800) : null,
  }
}

function toPickSeries(candidate: Candidate): PickSeries | null {
  const series = candidate.series
  if (!series) {
    const ref = primarySeries(candidate.work.series)
    return ref
      ? {
          name: ref.name,
          position: ref.position,
          books: null,
          latestReleaseYear: null,
        }
      : null
  }
  return {
    name: series.catalog.name,
    position: series.position,
    books: series.catalog.books.length,
    latestReleaseYear: series.catalog.latestReleaseDate
      ? Number(series.catalog.latestReleaseDate.slice(0, 4))
      : null,
  }
}

function lengthText(work: CatalogWork): string | null {
  if (work.runtimeMinutes)
    return `${Math.round(work.runtimeMinutes / 6) / 10} h audio`
  if (work.pages) return `${work.pages} pages`
  return null
}

function mergedPreferences(
  prefs: RecommendationPreferences,
  answers: InterviewAnswers | undefined,
): RecommendationPreferences {
  if (!answers) return prefs
  const favored = answers.subjects?.length
    ? answers.subjects
    : prefs.favorSubjects
  const avoidSubjects = answers.avoidSubjects?.length
    ? uniqueSubjects([...answers.avoidSubjects, ...prefs.avoidSubjects])
    : prefs.avoidSubjects
  return {
    ...prefs,
    seriesShape: answers.seriesShape ?? prefs.seriesShape,
    seriesLength:
      answers.seriesLength === undefined
        ? prefs.seriesLength
        : normalizeSeriesLengths(answers.seriesLength),
    format: answers.format ?? prefs.format,
    favorSubjects: withoutSubjects(favored, avoidSubjects),
    avoidSubjects,
  }
}

const GOALS: Record<string, string> = {
  continue: "Wants to continue a series they are reading.",
  new: "Wants something new: a new author or series.",
  like: "Wants something like particular books they loved.",
  surprise: "Wants to be surprised.",
}

function briefFor(
  round: RoundRow,
  prefs: RecommendationPreferences,
  anchor: Brief["anchor"],
): Brief {
  const answers = round.input.answers
  const lines: string[] = []
  if (answers?.goal) lines.push(GOALS[answers.goal] ?? "")
  if (answers?.likedBooks?.length) {
    lines.push(
      `Books they loved and want more like: ${answers.likedBooks.join("; ")}`,
    )
  }
  if (answers?.freeText) lines.push(`In their words: ${answers.freeText}`)
  if (answers?.format && answers.format !== "any") {
    lines.push(
      answers.format === "listen"
        ? "Wants to listen (audiobook)."
        : answers.format === "readalong"
          ? "Wants to read along with narration."
          : "Wants to read.",
    )
  }
  return {
    wish: round.input.wish ?? null,
    answers: lines.filter(Boolean),
    seriesShape: prefs.seriesShape,
    seriesLength: prefs.seriesLength,
    favorSubjects: prefs.favorSubjects,
    avoidSubjects: prefs.avoidSubjects,
    anchor,
  }
}

async function anchorOf(
  round: RoundRow,
  data: ReaderData,
): Promise<{
  title: string
  author: string
  rating: number | null
  work: CatalogWork | null
  seriesName: string | null
} | null> {
  const uuid = round.input.anchorBookUuid
  if (!uuid) return null
  const book = await getBook(uuid, round.userId)
  if (!book) return null
  const authors = book.authors.map((author) => author.name)
  const mine = data.byIdentity.get(workIdentity(book.title, authors))
  const resolved = await getCatalog().resolve({ title: book.title, authors })
  return {
    title: book.title,
    author: authors[0] ?? "",
    rating: mine?.rating ?? book.userBookRating?.rating ?? null,
    work: resolved?.work ?? null,
    seriesName: book.series[0]?.name ?? null,
  }
}

/** Gather candidates for the round's kind. */
async function gather(
  round: RoundRow,
  ai: AiConfig,
  profile: ReaderProfile,
  data: ReaderData,
  prefs: RecommendationPreferences,
  evidence: EvidenceBook,
  usage: TokenUsage,
): Promise<{
  candidates: Candidate[]
  brief: Brief
  anchorTitle: string | null
}> {
  const catalog = getCatalog()
  const anchor = await anchorOf(round, data)
  const brief = briefFor(round, prefs, anchor)
  globalEvidence(profile, evidence)
  if (brief.wish) evidence.add("asked", `You asked for: ${brief.wish}`)
  for (const line of brief.answers) evidence.add("asked", `You said: ${line}`)
  const asked = round.trigger === "tune" || round.trigger === "wish"
  const goal = round.input.answers?.goal ?? null
  const exclude = data.books
    .filter(
      (book) => book.status !== "to_read" && book.status !== "owned_unread",
    )
    .map((book) => `${book.title} — ${book.authors[0] ?? ""}`)

  const candidates: Candidate[] = []

  if (round.kind === "anchored") {
    if (!anchor)
      throw new RoundError("The finished book is no longer in your library")
    const fact = evidence.add(
      "finished",
      `You finished ${anchor.title}${anchor.rating != null ? ` and rated it ${anchor.rating}★` : ""}`,
    )
    if (anchor.seriesName) {
      const next = await seriesCandidates(
        profile,
        data,
        catalog,
        evidence,
        (series) => series.name === anchor.seriesName,
      )
      for (const candidate of next) {
        candidates.push({
          ...candidate,
          section: "finished",
          evidence: [...candidate.evidence, fact],
          prior: 1000,
        })
      }
    }
    if (anchor.work) {
      candidates.push(
        ...(await similarCandidates(
          [
            {
              key: anchor.work.key,
              title: anchor.title,
              rating: anchor.rating,
            },
          ],
          catalog,
          evidence,
          "finished",
          15,
        )),
      )
    }
    const { proposals, usage: used } = await proposeBooks(
      ai,
      profile,
      brief,
      { new: 0, stretch: 0, similar: 15 },
      exclude,
    )
    addUsage(usage, used)
    await setRoundStage(round.uuid, "verifying")
    candidates.push(
      ...(await verifyProposals(proposals, catalog, "finished", () => [fact])),
    )
    return { candidates, brief, anchorTitle: anchor.title }
  }

  const section = (natural: Section): Section => (asked ? "asked" : natural)
  if (!asked || goal === "continue" || goal === null || goal === "surprise") {
    for (const candidate of await seriesCandidates(
      profile,
      data,
      catalog,
      evidence,
    )) {
      candidates.push({ ...candidate, section: section("series") })
    }
  }
  if (!asked || goal !== "continue") {
    for (const candidate of await listCandidates(data, catalog, evidence)) {
      candidates.push({ ...candidate, section: section("lists") })
    }
    for (const candidate of await authorCandidates(
      profile,
      catalog,
      evidence,
    )) {
      candidates.push({ ...candidate, section: section("discover") })
    }
    const seeds = data.books
      .flatMap((book) =>
        book.catalogKey && (book.rating ?? 0) >= 4.5
          ? [
              {
                key: book.catalogKey,
                title: book.title,
                rating: book.rating,
                at: book.at,
              },
            ]
          : [],
      )
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
      .slice(0, 3)
    for (const candidate of await similarCandidates(
      seeds,
      catalog,
      evidence,
      "discover",
      8,
    )) {
      candidates.push({ ...candidate, section: section("discover") })
    }
    const { proposals, usage: used } = await proposeBooks(
      ai,
      profile,
      brief,
      { new: asked ? 20 : 18, stretch: asked ? 0 : 3, similar: 0 },
      exclude,
    )
    addUsage(usage, used)
    await setRoundStage(round.uuid, "verifying")
    candidates.push(
      ...(await verifyProposals(
        proposals,
        catalog,
        section("discover"),
        () => [],
      )),
    )
  } else {
    await setRoundStage(round.uuid, "verifying")
  }
  return { candidates, brief, anchorTitle: null }
}

/** Keep the most promising candidates for the one scoring call. */
function shortlist(candidates: Candidate[]): Candidate[] {
  const byOrigin = (origin: Candidate["origin"], limit: number) =>
    candidates
      .filter((candidate) => candidate.origin === origin)
      .sort((a, b) => b.prior - a.prior)
      .slice(0, limit)
  const picked = [
    ...byOrigin("series", 8),
    ...byOrigin("to_read", 6),
    ...byOrigin("owned", 3),
    ...byOrigin("author", 6),
    ...byOrigin("similar", 6),
    ...byOrigin("stretch", 2),
    ...byOrigin("proposal", 18),
  ]
  return picked.slice(0, MAX_CANDIDATES)
}

/** Run one round from its stored input to its stored picks. */
export async function runRound(uuid: UUID): Promise<void> {
  const round = await getRound(uuid)
  if (!round || round.status !== "running") return
  const usage = emptyUsage()
  const ai = await getAiConfig()
  try {
    if (!ai) throw new RoundError("Recommendations need an Anthropic API key")
    const reader = await ensureReader(round.userId)
    let prefs = preferencesOf(reader)
    const answers = round.input.answers
    if (answers?.saveAsUsual) {
      prefs = mergedPreferences(prefs, answers)
      await savePreferences(round.userId, prefs)
    } else {
      prefs = mergedPreferences(prefs, answers)
    }

    const { profile, data } = await rebuildProfile(round.userId, prefs)
    await setRoundStage(uuid, "finding")
    const evidence = new EvidenceBook()
    const gathered = await gather(
      round,
      ai,
      profile,
      data,
      prefs,
      evidence,
      usage,
    )

    const placed = await placeInSeries(gathered.candidates, getCatalog(), data)
    const { kept, ignoredTwice } = filterCandidates(placed, {
      data,
      profile,
      avoidSubjects: prefs.avoidSubjects,
      restIgnored: round.trigger === "weekly",
    })
    const chosen = shortlist(kept)

    await setRoundStage(uuid, "ranking")
    const ids = new Map(
      chosen.map((candidate, index) => [`c${index + 1}`, candidate]),
    )
    const { scores, usage: used } = await scoreCandidates(
      ai,
      profile,
      gathered.brief,
      [...ids].map(([id, candidate]) => ({
        id,
        title: candidate.work.title,
        authors: candidate.work.authors,
        series: (() => {
          const name =
            candidate.series?.catalog.name ??
            primarySeries(candidate.work.series)?.name
          if (!name) return null
          // Length stays out: code applies that preference, not the model.
          return candidate.series
            ? `${name} #${candidate.series.position}`
            : name
        })(),
        year: candidate.work.releaseDate
          ? Number(candidate.work.releaseDate.slice(0, 4))
          : null,
        length: lengthText(candidate.work),
        subjects: candidate.work.subjects.slice(-5),
        description: candidate.work.description?.slice(0, 300) ?? null,
        evidence: candidate.evidence.map((item) => `${item.id}: ${item.text}`),
      })),
      evidence.items,
    )
    addUsage(usage, used)

    const needsAudio = prefs.format === "listen" || prefs.format === "readalong"
    type Scored = Candidate & {
      fit: number
      score: number
      reason: string
      why: string
      cited: typeof evidence.items
      label: string | null
      authors: string[]
      seriesKey: string | null
      stretch: boolean
    }
    const scored: Scored[] = []
    const dropped = { noEvidence: 0, lowFit: 0, unknown: 0 }
    for (const score of scores) {
      const candidate = ids.get(
        /^c\d+/.exec(score.candidate.trim())?.[0] ?? score.candidate,
      )
      if (!candidate) dropped.unknown++
      if (!candidate || scored.some((s) => s.identity === candidate.identity))
        continue
      // The model sometimes repeats the fact after its id ("e3: You said…").
      const cited = score.evidence
        .map((id) => evidence.get(/^e\d+/.exec(id.trim())?.[0] ?? id))
        .filter((item): item is NonNullable<typeof item> => !!item)
      const fit = Math.max(0, Math.min(100, score.fit))
      if (fit < MIN_FIT) {
        dropped.lowFit++
        continue
      }
      // A reason that cites nothing real is not shown.
      if (!cited.length) {
        dropped.noEvidence++
        continue
      }
      // Without the catalog's series listing the shape and length are
      // unknown (catalogs omit series for some series books): no penalty
      // and no label rather than a wrong "Standalone".
      const unknownSeries = !candidate.series
      const { penalty, label } = preferencePenalty(
        {
          seriesBooks: candidate.series?.catalog.books.length ?? null,
          hasAudio: candidate.work.key.startsWith("audible:"),
        },
        {
          seriesShape: unknownSeries ? "either" : prefs.seriesShape,
          seriesLength: prefs.seriesLength,
          needsAudio,
        },
      )
      scored.push({
        ...candidate,
        fit,
        score:
          fit -
          penalty -
          candidate.softPenalty +
          (candidate.section === "finished" ? candidate.prior / 100 : 0),
        reason: score.reason.slice(0, 140),
        why: score.why.slice(0, 1000),
        cited,
        label,
        authors: candidate.work.authors,
        // One pick per series family, however the catalog splits it.
        seriesKey: (() => {
          const name =
            candidate.series?.catalog.name ??
            primarySeries(candidate.work.series)?.name
          return name ? seriesFamily(name) : null
        })(),
        stretch: candidate.origin === "stretch",
      })
    }

    const order: Section[] =
      round.kind === "anchored"
        ? ["finished"]
        : round.trigger === "tune" || round.trigger === "wish"
          ? ["asked"]
          : ["series", "lists", "discover"]
    const taken = newDiversityState()
    const placedPicks: NewPick[] = []
    for (const section of order) {
      const inSection = scored.filter((item) => item.section === section)
      for (const [index, item] of applyDiversity(
        inSection,
        SECTION_LIMITS[section],
        taken,
      ).entries()) {
        placedPicks.push({
          workKey: item.work.key,
          workIdentity: item.identity,
          work: toPickWork(item.work),
          section,
          rank: placedPicks.length + 1,
          fitScore: item.fit,
          adjustedScore: Math.round(item.score * 10) / 10,
          pill: item.pill,
          label: item.label,
          note: item.note,
          reason: item.reason,
          why: item.why,
          evidence: item.cited,
          series: toPickSeries(item),
          anchorTitle: section === "finished" ? gathered.anchorTitle : null,
        })
        void index
      }
    }

    if (!placedPicks.length && round.kind === "full" && order[0] === "asked") {
      throw new RoundError(
        "Nothing in the catalog fit what you asked. Try saying it another way.",
      )
    }
    await completeRound(uuid, round.userId, placedPicks, {
      model: ai.model,
      ...usage,
      costMicroUsd: costMicroUsd(ai.model, usage),
    })
    if (ignoredTwice.length) await restIgnored(round.userId, ignoredTwice)
    if (
      round.trigger === "weekly" &&
      prefs.notifyNewPicks &&
      placedPicks.length
    ) {
      const first = (await getAllPicks(round.userId)).find(
        (pick) => pick.roundUuid === uuid,
      )
      if (first) {
        await sendToReader(round.userId, {
          title: `${placedPicks.length} new picks for you`,
          body: placedPicks
            .slice(0, 3)
            .map((pick) => pick.work.title)
            .join(", "),
          data: { recommendationUuid: first.uuid },
          channel: "recommendations",
        })
      }
    }
    logger.info({
      msg: "Recommendation round finished",
      round: uuid,
      trigger: round.trigger,
      picks: placedPicks.length,
      candidates: chosen.length,
      dropped,
    })
  } catch (error) {
    const message =
      error instanceof RoundError
        ? error.message
        : "Something went wrong while picking books"
    logger.warn({
      msg: "Recommendation round failed",
      round: uuid,
      error: error instanceof Error ? error.message : String(error),
    })
    if (ai) {
      await recordRoundCost(uuid, {
        model: ai.model,
        costMicroUsd: costMicroUsd(ai.model, usage),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })
    }
    await failRound(uuid, message)
  }
}

/** Picks left alone in two weekly rounds in a row rest for four weeks. */
async function restIgnored(userId: UUID, identities: string[]): Promise<void> {
  const until = sqlTime(Date.now() + 28 * DAY_MS)
  const latest = new Map<string, UUID>()
  for (const pick of await getAllPicks(userId)) {
    if (
      identities.includes(pick.workIdentity) &&
      !latest.has(pick.workIdentity)
    ) {
      latest.set(pick.workIdentity, pick.uuid)
    }
  }
  for (const uuid of latest.values())
    await updatePick(uuid, { restedUntil: until })
}
