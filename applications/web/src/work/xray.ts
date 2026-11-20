import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cwd } from "node:process"

import Piscina from "piscina"

import {
  type BookSource,
  type CallModel,
  type GenerationState,
  STALE_STATE_MESSAGE,
  createAnthropicModel,
  generateXray,
} from "@storyteller-platform/xray"

import { getXrayFilepath, getXrayStateFilepath } from "@/assets/paths"
import { removeXrayFiles } from "@/assets/xray"
import { getBookOrThrow } from "@/database/books"
import { type Job, getJob, nowTimestamp, updateJob } from "@/database/jobs"
import { getSettings } from "@/database/settings"
import { XRAY_DIR } from "@/directories"
import { env } from "@/env"
import { logger } from "@/logging"

export type XraySourceReader = (
  task: { epubPath: string },
  signal?: AbortSignal,
) => Promise<BookSource>

declare global {
  // eslint-disable-next-line no-var
  var xraySourcePiscina: Piscina | undefined
}

const sourcePiscina = (globalThis.xraySourcePiscina ??= new Piscina({
  filename: join(cwd(), "work-dist", env.STORYTELLER_WORKER),
  minThreads: 0,
  maxThreads: 1,
  idleTimeout: 30_000,
  ...(env.NODE_ENV === "development" && {
    env: {
      ...process.env,
      NODE_OPTIONS:
        "--conditions=@storyteller-node --disable-warning=ExperimentalWarning --experimental-transform-types",
    },
  }),
}))

async function writeJsonAtomically(filepath: string, value: unknown) {
  const temporary = `${filepath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value))
    await rename(temporary, filepath)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function readState(
  filepath: string,
): Promise<GenerationState | undefined> {
  try {
    return JSON.parse(await readFile(filepath, "utf-8")) as GenerationState
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined
    }
    if (error instanceof SyntaxError) {
      await rm(filepath, { force: true })
      return undefined
    }
    throw error
  }
}

/** Runs outside the GPU worker; one network-bound job is admitted by the distributor. */
export async function runXrayJob(
  job: Job,
  options: {
    callModel?: CallModel
    readSource?: XraySourceReader
    signal?: AbortSignal
    getAbortIntent?: () => "cancel" | "pause"
  } = {},
): Promise<void> {
  let progressUpdates = Promise.resolve()
  let progressError: Error | undefined
  try {
    options.signal?.throwIfAborted()
    if (!job.bookUuid) throw new Error("X-Ray job has no book")
    const book = await getBookOrThrow(job.bookUuid)
    if (!book.ebook?.filepath || book.ebook.missing) {
      throw new Error("Cannot generate X-Ray: this book has no ebook file.")
    }
    const ebookPath = book.ebook.filepath
    const settings = await getSettings()
    let callModel = options.callModel
    if (!callModel) {
      const apiKey = settings.xrayAnthropicApiKey
      if (!apiKey?.trim()) {
        throw new Error("No Anthropic API key is configured for X-Ray.")
      }
      callModel = createAnthropicModel({ apiKey, model: settings.xrayModel })
    }
    const probe = join(XRAY_DIR, `${job.uuid}.write-test`)
    try {
      await mkdir(XRAY_DIR, { recursive: true })
      await writeFile(probe, "")
      await rm(probe)
    } catch (error) {
      try {
        await rm(probe, { force: true })
      } catch (cleanupError) {
        logger.warn({
          msg: "Failed to remove the X-Ray write probe",
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        })
      }
      throw new Error(
        `Cannot write to the X-Ray data directory: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    options.signal?.throwIfAborted()
    const task = { epubPath: ebookPath }
    const source = options.readSource
      ? await options.readSource(task, options.signal)
      : ((await sourcePiscina.run(task, {
          name: "readXraySource",
          signal: options.signal,
        })) as BookSource)
    options.signal?.throwIfAborted()
    const statePath = getXrayStateFilepath(book.uuid)
    let resume = await readState(statePath)
    const generate = () =>
      generateXray(source, {
        model: settings.xrayModel,
        callModel: async (request) => {
          options.signal?.throwIfAborted()
          if (progressError !== undefined) throw progressError
          if (!(await getJob(job.uuid))) {
            throw new Error("The book was removed during X-Ray generation")
          }
          options.signal?.throwIfAborted()
          return callModel(request)
        },
        ...(resume && { resume }),
        onProgress: (progress) => {
          options.signal?.throwIfAborted()
          progressUpdates = progressUpdates
            .then(async () => {
              await updateJob(job.uuid, { progress })
            })
            .catch((error: unknown) => {
              progressError =
                error instanceof Error
                  ? error
                  : new Error(String(error), { cause: error })
            })
        },
        onRejection: (segmentIndex, note) => {
          const entry = {
            msg: "X-Ray passage note",
            jobUuid: job.uuid,
            bookUuid: book.uuid,
            segmentIndex,
            note,
          }
          if (note.startsWith("passage skipped:")) logger.warn(entry)
          else logger.debug(entry)
        },
        onCheckpoint: async (state) => {
          await writeJsonAtomically(statePath, state)
          await progressUpdates
          if (progressError !== undefined) throw progressError
          // Save the paid-for passage before stopping an in-flight request.
          options.signal?.throwIfAborted()
        },
      })

    let result
    try {
      result = await generate()
    } catch (error) {
      if (
        !resume ||
        !(error instanceof Error) ||
        error.message !== STALE_STATE_MESSAGE
      ) {
        throw error
      }
      await rm(statePath, { force: true })
      resume = undefined
      result = await generate()
    }

    await progressUpdates
    if (progressError !== undefined) throw progressError
    options.signal?.throwIfAborted()
    if (!(await getJob(job.uuid))) {
      await rm(statePath, { force: true })
      return
    }
    await writeJsonAtomically(getXrayFilepath(book.uuid), result.xray)
    await rm(statePath, { force: true })
    await updateJob(job.uuid, {
      status: "DONE",
      progress: 1,
      error: null,
      finishedAt: nowTimestamp(),
    })
    logger.info({
      msg:
        result.skippedSegments > 0
          ? "X-Ray generation completed with skipped passages"
          : "X-Ray generation completed",
      jobUuid: job.uuid,
      bookUuid: book.uuid,
      skippedSegments: result.skippedSegments,
    })
  } catch (error) {
    await progressUpdates
    if (!(await getJob(job.uuid))) {
      if (job.bookUuid) {
        await removeXrayFiles(job.bookUuid)
      }
      return
    }
    if (options.signal?.aborted) {
      const paused = options.getAbortIntent?.() === "pause"
      await updateJob(job.uuid, {
        status: paused ? "PAUSED" : "CANCELED",
        finishedAt: paused ? null : nowTimestamp(),
      })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    await updateJob(job.uuid, {
      status: "ERROR",
      finishedAt: nowTimestamp(),
      error: message,
    })
    logger.error({
      msg: "X-Ray generation failed",
      jobUuid: job.uuid,
      error: message,
    })
  }
}
