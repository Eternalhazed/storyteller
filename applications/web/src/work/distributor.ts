import { stat } from "node:fs/promises"
import { extname, join, resolve } from "node:path"
import { cwd } from "node:process"
import { MessageChannel } from "node:worker_threads"

import { AsyncMutex } from "@esfx/async-mutex"
import Piscina from "piscina"

import type { CallModel } from "@storyteller-platform/xray"

import { setEbookImportHandler } from "@/assets/library/scanner/ebook-import"
import { pathBelongsTo } from "@/assets/library/scanner/folder"
import { filepathFolder, scan } from "@/assets/library/scanner/scan"
import {
  suppressPrefix,
  unsuppressPrefix,
} from "@/assets/library/scanner/write-intent"
import { getReadaloudFilepath, getXrayFilepath } from "@/assets/paths"
import {
  type BookRelationsUpdate,
  type BookUpdate,
  type BookWithRelations,
  type Readaloud,
  getBook,
  getBookOrThrow,
  updateBook,
} from "@/database/books"
import {
  type Job,
  type JobType,
  createJob,
  getActiveJobForBook,
  getJob,
  getJobs,
  getNextJobPosition,
  nowTimestamp,
  reorderQueuedJobs,
  updateJob,
} from "@/database/jobs"
import { getSettings } from "@/database/settings"
import { env } from "@/env"
import { logger } from "@/logging"
import type { UUID } from "@/uuid"

import type { JobStats } from "./jobStats"
import { type RunConfig, buildRunConfig } from "./runConfig"
import { STAGE_ORDER } from "./stages"
import type processBook from "./worker"
import { type XraySourceReader, runXrayJob } from "./xray"

export type RestartMode = false | "full" | "transcription" | "sync"

const MAX_CONCURRENT = 1

/**
 * Next.js app directory seems to have a bug where, in production,
 * a single module can be imported multiple times (breaking the module
 * cache) if it's depended on by different modules that end up in different
 * bundled chunks.
 *
 * This results in multiple instances of the module level values in this
 * module, all of which rely on being singletons to work correctly.
 */
declare global {
  // variables declared with const/let cannot be added to the global scope
  /* eslint-disable no-var */
  var jobControllers: Map<UUID, AbortController> | undefined
  var jobAbortIntents: Map<UUID, "cancel" | "pause"> | undefined
  var alignmentPiscina: Piscina | undefined
  var xrayJobControllers: Map<UUID, AbortController> | undefined
  var jobPumpMutex: AsyncMutex | undefined
  var jobFinalizationFailures: Set<UUID> | undefined
  /* eslint-enable no-var */
}

let controllers: Map<UUID, AbortController>
if (globalThis.jobControllers) {
  controllers = globalThis.jobControllers
} else {
  controllers = new Map()
  globalThis.jobControllers = controllers
}

let abortIntents: Map<UUID, "cancel" | "pause">
if (globalThis.jobAbortIntents) {
  abortIntents = globalThis.jobAbortIntents
} else {
  abortIntents = new Map()
  globalThis.jobAbortIntents = abortIntents
}

const filename = join(cwd(), "work-dist", env.STORYTELLER_WORKER)

let alignmentPiscina: Piscina
if (globalThis.alignmentPiscina) {
  alignmentPiscina = globalThis.alignmentPiscina
} else {
  alignmentPiscina = new Piscina({
    filename,
    minThreads: 0,
    maxThreads: 1,
    idleTimeout: 30_000,
    // In dev, we don't bundle packages in the worker.
    // These flags allow us to import directly from the
    // source typescript files for our own packages (e.g. @storyteller-platform/epub)
    ...(env.NODE_ENV === "development" && {
      env: {
        ...process.env,
        NODE_OPTIONS:
          "--conditions=@storyteller-node --disable-warning=ExperimentalWarning --experimental-transform-types",
      },
    }),
  })
  globalThis.alignmentPiscina = alignmentPiscina
}

const xrayControllers = (globalThis.xrayJobControllers ??= new Map<
  UUID,
  AbortController
>())
const pumpMutex = (globalThis.jobPumpMutex ??= new AsyncMutex())
const finalizationFailures = (globalThis.jobFinalizationFailures ??=
  new Set<UUID>())

export function getJobAbortIntent(jobUuid: UUID) {
  return abortIntents.get(jobUuid)
}

export async function enqueueBookAlign(
  bookUuid: UUID,
  restart: RestartMode,
  overrides?: Partial<RunConfig>,
): Promise<Job> {
  const existing = await getActiveJobForBook(bookUuid, "book_align")
  if (existing) {
    return existing
  }

  const book = await getBookOrThrow(bookUuid)
  const settings = await getSettings()
  const config = buildRunConfig(settings, book.language ?? null, overrides)

  const effectiveRestart = clampRestart(restart, book)
  const startStage = getStartStage(effectiveRestart, book)
  const position = await getNextJobPosition()

  const job = await createJob({
    type: "book_align",
    bookUuid,
    restart: effectiveRestart,
    config,
    position,
  })

  await updateJob(job.uuid, { stage: startStage })

  await updateBook(bookUuid, null, {
    readaloud: {
      status: "QUEUED",
      currentStage: startStage,
      queuePosition: position,
      restartPending: effectiveRestart || null,
    },
  })

  void pump()
  return job
}

export async function enqueueBookXray(bookUuid: UUID): Promise<Job> {
  let job: Job
  await pumpMutex.lock()
  try {
    const existing = await getActiveJobForBook(bookUuid, "book_xray")
    if (existing) return existing
    job = await createJob({
      type: "book_xray",
      bookUuid,
      restart: false,
      config: null,
      position: await getNextJobPosition(),
    })
  } finally {
    pumpMutex.unlock()
  }
  void pump()
  return job
}

export async function maybeEnqueueBookXray(bookUuid: UUID): Promise<void> {
  try {
    const settings = await getSettings()
    if (!settings.xrayAutoGenerate || !settings.xrayAnthropicApiKey?.trim())
      return
    const book = await getBook(bookUuid)
    if (!book?.ebook?.filepath || book.ebook.missing) return
    try {
      const file = await stat(getXrayFilepath(bookUuid))
      if (file.size > 0) return
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error
      }
    }
    await enqueueBookXray(bookUuid)
  } catch (error) {
    logger.warn({
      msg: "Failed to queue automatic X-Ray generation",
      bookUuid,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

setEbookImportHandler(maybeEnqueueBookXray)

async function claimNextJob(type: JobType): Promise<Job | undefined> {
  await pumpMutex.lock()
  try {
    const lane = type === "book_xray" ? xrayControllers : controllers
    if (lane.size >= MAX_CONCURRENT) return undefined

    const next = (
      await getJobs({
        statuses: ["QUEUED", "RUNNING"],
        type,
      })
    ).find((job) => !finalizationFailures.has(job.uuid))
    if (!next) return undefined

    const abortController = new AbortController()
    lane.set(next.uuid, abortController)
    try {
      return await updateJob(next.uuid, {
        status: "RUNNING",
        startedAt:
          type === "book_xray"
            ? next.startedAt ?? nowTimestamp()
            : nowTimestamp(),
        error: null,
      })
    } catch (error) {
      lane.delete(next.uuid)
      throw error
    }
  } finally {
    pumpMutex.unlock()
  }
}

export async function pump(
  callModel?: CallModel,
  readSource?: XraySourceReader,
): Promise<void> {
  const running: Promise<void>[] = []
  for (const type of ["book_align", "book_xray"] as const) {
    let job: Job | undefined
    try {
      job = await claimNextJob(type)
    } catch (error) {
      logger.error({
        msg: "Failed to claim a queued job",
        type,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (!job) continue
    const claimed = job
    const lane = type === "book_xray" ? xrayControllers : controllers
    running.push(
      runJob(claimed, callModel, readSource)
        .catch(async (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          logger.error({
            msg: "Job runner failed",
            jobUuid: claimed.uuid,
            type,
            error: message,
          })
          const intent = abortIntents.get(claimed.uuid)
          try {
            await updateJob(claimed.uuid, {
              status:
                intent === "pause"
                  ? "PAUSED"
                  : intent === "cancel"
                    ? "CANCELED"
                    : "ERROR",
              finishedAt: intent === "pause" ? null : nowTimestamp(),
              error: intent ? null : message,
            })
          } catch (writeError) {
            // Do not immediately reclaim a RUNNING row whose final write failed.
            finalizationFailures.add(claimed.uuid)
            logger.error({
              msg: "Failed to record the job runner failure",
              jobUuid: claimed.uuid,
              error:
                writeError instanceof Error
                  ? writeError.message
                  : String(writeError),
            })
          }
        })
        .finally(() => {
          lane.delete(claimed.uuid)
          abortIntents.delete(claimed.uuid)
          void pump(callModel, readSource)
        }),
    )
  }
  await Promise.all(running)
}

async function runJob(
  job: Job,
  callModel?: CallModel,
  readSource?: XraySourceReader,
): Promise<void> {
  if (job.type === "book_xray") {
    const controller = xrayControllers.get(job.uuid)
    if (!controller) return
    await runXrayJob(job, {
      callModel,
      readSource,
      signal: controller.signal,
      getAbortIntent: () => abortIntents.get(job.uuid) ?? "cancel",
    })
    return
  }
  if (!job.bookUuid) {
    logger.error(`Job ${job.uuid} is not a runnable book_align job`)
    await updateJob(job.uuid, { status: "ERROR", error: "invalid job" })
    return
  }

  const bookUuid = job.bookUuid
  const abortController = controllers.get(job.uuid)
  if (!abortController) return

  const book = await getBookOrThrow(bookUuid)

  const filePaths = [
    book.ebook?.filepath,
    book.audiobook?.filepath,
    book.readaloud?.filepath,
  ]
    .filter((filepath) => filepath != undefined)
    .map((filepath) => resolve(filepath))

  const dirs = filePaths.filter((dir) => !extname(dir))
  const realFilePaths = filePaths.filter(
    (path) => !dirs.some((dir) => pathBelongsTo(dir, path)),
  )
  const toSupress = [...dirs, ...realFilePaths]

  if (book.ebook?.filepath) {
    try {
      const settings = await getSettings()
      toSupress.push(getReadaloudFilepath(book, settings))
    } catch (err) {
      logger.warn({
        msg: "Failed to predict readaloud filepath for suppression",
        bookUuid,
        err,
      })
    }
  }

  const refreshSuppression = () => {
    for (const fp of toSupress) suppressPrefix(fp)
  }

  const { port1, port2 } = new MessageChannel()

  port2.on(
    "message",
    async (message: {
      requestId: UUID
      update: BookUpdate | null
      relations: BookRelationsUpdate
    }) => {
      refreshSuppression()

      if (message.relations.readaloud?.filepath) {
        toSupress.push(message.relations.readaloud.filepath)
      }

      const updated = await updateBook(
        bookUuid,
        message.update,
        message.relations,
      )

      const readaloud = message.relations.readaloud
      if (readaloud) {
        await updateJob(job.uuid, {
          stage: readaloud.currentStage,
          progress: readaloud.stageProgress,
        })
      }

      port2.postMessage({ requestId: message.requestId, book: updated })
    },
  )

  refreshSuppression()

  try {
    const stats = (await alignmentPiscina.run(
      {
        jobUuid: job.uuid,
        bookUuid,
        restart: job.restart ?? false,
        config: job.config,
        port: port1,
      } satisfies Parameters<typeof processBook>[0],
      { transferList: [port1], signal: abortController.signal },
    )) as JobStats | undefined

    const finished = await getBookOrThrow(bookUuid)

    if (finished.readaloud?.status === "ERROR") {
      logger.error(
        `Processing for "${finished.title}" (${bookUuid}) failed during ${finished.readaloud.currentStage}. See the error log above for details.`,
      )
      await updateJob(job.uuid, {
        status: "ERROR",
        finishedAt: nowTimestamp(),
        error: `failed during ${finished.readaloud.currentStage}`,
      })
      return
    }

    if (!finished.readaloud?.filepath) {
      throw new Error(
        `Processing completed for "${finished.title}" (${bookUuid}) but no aligned file was produced. This is likely a bug.`,
      )
    }

    await scan({
      source: "readaloud-creation",
      request: {
        kind: "candidates",
        candidates: [
          {
            filepath: finished.readaloud.filepath,
            format: "readaloud",
            existingBook: finished,
            folder: filepathFolder(finished.readaloud.filepath),
          },
        ],
      },
      options: { concurrency: 1 },
      signal: AbortSignal.timeout(10000),
    })

    await updateJob(job.uuid, {
      status: "DONE",
      progress: 1,
      finishedAt: nowTimestamp(),
      stats: stats ?? undefined,
    })
    await maybeEnqueueBookXray(bookUuid)
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const intent = abortIntents.get(job.uuid) ?? "cancel"
      const current = await getBookOrThrow(bookUuid)
      const stage = current.readaloud?.currentStage ?? "SPLIT_TRACKS"

      logger.info(`Processing for job ${job.uuid} ${intent}d by user`)

      await updateBook(bookUuid, null, {
        readaloud: {
          status: "STOPPED",
          currentStage: stage,
          queuePosition: null,
          restartPending: null,
        },
      })

      await updateJob(job.uuid, {
        status: intent === "pause" ? "PAUSED" : "CANCELED",
        stage,
        finishedAt: intent === "pause" ? null : nowTimestamp(),
      })
      return
    }

    const current = await getBookOrThrow(bookUuid)
    await updateBook(bookUuid, null, {
      readaloud: {
        status: "ERROR",
        currentStage: current.readaloud?.currentStage ?? "SPLIT_TRACKS",
        queuePosition: null,
        restartPending: null,
      },
    })

    await updateJob(job.uuid, {
      status: "ERROR",
      finishedAt: nowTimestamp(),
      error: err instanceof Error ? err.message : String(err),
    })

    logger.error(`Processing for job ${job.uuid} failed unexpectedly`)
    logger.error(err)
  } finally {
    for (const fp of toSupress) unsuppressPrefix(fp)
  }
}

export async function cancelJob(jobUuid: UUID): Promise<void> {
  const job = await getJob(jobUuid)
  if (!job) return

  const lane = job.type === "book_xray" ? xrayControllers : controllers
  const controller = lane.get(jobUuid)
  if (controller) {
    abortIntents.set(jobUuid, "cancel")
    controller.abort()
    return
  }

  await updateJob(jobUuid, { status: "CANCELED", finishedAt: nowTimestamp() })
  finalizationFailures.delete(jobUuid)
  if (job.type === "book_align" && job.bookUuid) {
    await updateBook(job.bookUuid, null, {
      readaloud: {
        status: "STOPPED",
        currentStage: job.stage ?? "SPLIT_TRACKS",
        queuePosition: null,
        restartPending: null,
      },
    })
  }
  void pump()
}

export async function pauseJob(jobUuid: UUID): Promise<void> {
  const job = await getJob(jobUuid)
  if (!job) return

  const lane = job.type === "book_xray" ? xrayControllers : controllers
  const controller = lane.get(jobUuid)
  if (controller) {
    abortIntents.set(jobUuid, "pause")
    controller.abort()
    return
  }

  if (job.status === "QUEUED") {
    await updateJob(jobUuid, { status: "PAUSED" })
  }
}

export async function resumeJob(jobUuid: UUID): Promise<void> {
  const job = await getJob(jobUuid)
  if (!job || job.status !== "PAUSED") return

  const position = await getNextJobPosition()
  await updateJob(jobUuid, {
    status: "QUEUED",
    position,
    finishedAt: null,
  })
  finalizationFailures.delete(jobUuid)
  if (job.type === "book_align" && job.bookUuid) {
    await updateBook(job.bookUuid, null, {
      readaloud: {
        status: "QUEUED",
        currentStage: job.stage ?? "SPLIT_TRACKS",
        queuePosition: position,
      },
    })
  }
  void pump()
}

export async function reorderJobs(orderedUuids: UUID[]): Promise<void> {
  await reorderQueuedJobs(orderedUuids)
}

export async function cancelProcessing(bookUuid: UUID): Promise<void> {
  const job = await getActiveJobForBook(bookUuid, "book_align")
  if (job) await cancelJob(job.uuid)
}

export async function startProcessing(
  bookUuid: UUID,
  restart: RestartMode,
): Promise<void> {
  await enqueueBookAlign(bookUuid, restart)
}

function clampRestart(
  restart: RestartMode,
  book: BookWithRelations,
): RestartMode {
  if (restart === false || restart === "full") return restart

  const bookStage = book.readaloud?.currentStage ?? "SPLIT_TRACKS"
  const targetStage: Readaloud["currentStage"] =
    restart === "transcription" ? "TRANSCRIBE_CHAPTERS" : "SYNC_CHAPTERS"

  if (STAGE_ORDER[targetStage] > STAGE_ORDER[bookStage]) return false

  return restart
}

function getStartStage(
  restart: RestartMode,
  book: BookWithRelations,
): Readaloud["currentStage"] {
  if (restart === "full") return "SPLIT_TRACKS"
  if (restart === "transcription") return "TRANSCRIBE_CHAPTERS"
  if (restart === "sync") return "SYNC_CHAPTERS"
  return book.readaloud?.currentStage ?? "SPLIT_TRACKS"
}
