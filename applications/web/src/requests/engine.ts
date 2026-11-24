import { dirname, resolve, sep } from "node:path"

import {
  DeliveryError,
  deliverFormat,
  isPresent,
} from "@/assets/library/deliver"
import { pathBelongsTo } from "@/assets/library/paths"
import { isAudioFile } from "@/audio"
import {
  type BookRequest,
  type BookRequestUpdate,
  type RequestEventInput,
  getOpenBookRequests,
  updateBookRequest,
} from "@/database/bookRequests"
import { getBook } from "@/database/books"
import { getJob, getLatestJobForBook } from "@/database/jobs"
import { type JobStatus } from "@/jobStatuses"
import { logger } from "@/logging"
import { enqueueBookAlign } from "@/work/distributor"

import { type AcquisitionAdapter, type ReleaseRef } from "./adapter"
import {
  type AlignStatus,
  type ChosenRelease,
  type FormatStatus,
  type Milestone,
  type RequestFormat,
  type TorrentStatus,
} from "./types"

/** No new bytes for this long after adding means the download is stalled. */
export const STALL_MS = 30 * 60_000

export type RequestNotifier = (
  request: BookRequest,
  milestone: Milestone,
) => Promise<void>

export type EngineDeps = {
  adapter: AcquisitionAdapter
  /** Where this server sees the adapter's download folder. */
  seedDir: string
  notify: RequestNotifier
  now?: () => number
}

type FormatFields = {
  status: FormatStatus
  release: ChosenRelease | null
  infohash: string | null
  bytesDone: number
  progressAt: number | null
  addedAt: number | null
}

function formatFields(
  request: BookRequest,
  format: RequestFormat,
): FormatFields {
  return format === "ebook"
    ? {
        status: request.ebookStatus,
        release: request.ebookRelease,
        infohash: request.ebookInfohash,
        bytesDone: request.ebookBytesDone,
        progressAt: request.ebookProgressAt,
        addedAt: request.ebookAddedAt,
      }
    : {
        status: request.audioStatus,
        release: request.audioRelease,
        infohash: request.audioInfohash,
        bytesDone: request.audioBytesDone,
        progressAt: request.audioProgressAt,
        addedAt: request.audioAddedAt,
      }
}

/** A patch to one format's columns, named without the format prefix. */
type FormatPatch = Partial<{
  status: FormatStatus
  progress: number
  bytesDone: number
  progressAt: number | null
  addedAt: number | null
  reused: boolean
  error: string | null
}>

function prefixed(
  format: RequestFormat,
  patch: FormatPatch,
): BookRequestUpdate {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    out[`${format}${key[0]?.toUpperCase()}${key.slice(1)}`] = value
  }
  return out
}

const FORMAT_NAMES: Record<RequestFormat, string> = {
  ebook: "Ebook",
  audio: "Audiobook",
}

/** The folder a request's download is saved to, under the seed root. */
export function seedFolderFor(
  release: ChosenRelease,
  infohash: string,
): string {
  return `${release.source}/${infohash}`
}

/**
 * Resolve a path the adapter reported inside the seed root, refusing any
 * that would point outside it.
 */
function inSeedDir(seedDir: string, ...parts: string[]): string {
  const path = resolve(seedDir, ...parts)
  if (!pathBelongsTo(seedDir, path)) {
    throw new DeliveryError(
      `The download reports a path outside the seed folder`,
      false,
    )
  }
  return path
}

/** The file or folder to import for a finished download. */
export function deliverySource(
  seedDir: string,
  format: RequestFormat,
  torrent: TorrentStatus,
): string {
  if (torrent.folder === null) {
    throw new DeliveryError(
      "The download keeps its files outside the seed folder",
      false,
    )
  }
  const root = inSeedDir(seedDir, torrent.folder)

  if (format === "ebook") {
    const [epub] = torrent.files
      .filter((file) => /\.epub$/i.test(file.path))
      .toSorted((a, b) => b.size - a.size)
    if (!epub) throw new DeliveryError("The download has no EPUB file", false)
    return inSeedDir(root, epub.path)
  }

  const tracks = torrent.files.filter((file) => isAudioFile(file.path))
  if (!tracks.length) {
    throw new DeliveryError("The download has no audio files", false)
  }
  // The deepest folder holding every track, so disc sub-folders come along.
  const dirs = tracks.map((track) =>
    dirname(inSeedDir(root, track.path)).split(sep),
  )
  const [first = []] = dirs
  let shared = first.length
  for (const dir of dirs) {
    let i = 0
    while (i < shared && dir[i] === first[i]) i++
    shared = i
  }
  // Every track is inside the download's folder, so this never goes above it.
  return first.slice(0, shared).join(sep)
}

const ALIGN_STATUS_BY_JOB: Record<JobStatus, AlignStatus> = {
  QUEUED: "queued",
  RUNNING: "syncing",
  PAUSED: "paused",
  DONE: "done",
  ERROR: "failed",
  CANCELED: "failed",
}

export class RequestEngine {
  private readonly now: () => number

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now
  }

  private async update(
    request: BookRequest,
    patch: BookRequestUpdate,
    event?: RequestEventInput,
  ): Promise<BookRequest> {
    return await updateBookRequest(request.uuid, patch, event)
  }

  /**
   * Record a milestone before sending it: a crash in between loses one
   * notification, never sends two. The Home card shows the same state.
   */
  private async reach(
    request: BookRequest,
    milestone: Milestone,
  ): Promise<BookRequest> {
    if (request.notified.includes(milestone)) return request
    const updated = await this.update(request, {
      notified: [...request.notified, milestone],
    })
    try {
      await this.deps.notify(updated, milestone)
    } catch (error) {
      logger.warn({
        msg: "Failed to send a book request notification",
        requestUuid: request.uuid,
        milestone,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return updated
  }

  /** Advance every open request by whatever steps are possible now. */
  async tick(): Promise<void> {
    const requests = await getOpenBookRequests()
    if (!requests.length) return

    const hashes = new Set<string>()
    for (const request of requests) {
      for (const format of ["ebook", "audio"] as const) {
        const fields = formatFields(request, format)
        if (
          fields.infohash &&
          ["downloading", "stalled", "importing"].includes(fields.status)
        ) {
          hashes.add(fields.infohash)
        }
      }
    }

    let torrents: Map<string, TorrentStatus> | null = null
    try {
      const statuses = await this.deps.adapter.status([...hashes])
      torrents = new Map(statuses.map((status) => [status.infohash, status]))
    } catch (error) {
      logger.warn({
        msg: "Could not read download status; downloads wait for the next check",
        error: error instanceof Error ? error.message : String(error),
      })
    }

    for (const request of requests) {
      try {
        await this.advance(request, torrents)
      } catch (error) {
        logger.error({
          msg: "Failed to advance a book request",
          requestUuid: request.uuid,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * One pass over one request. Every step reads the stored state first and
   * is safe to repeat, so a pass interrupted anywhere is finished by the next.
   */
  async advance(
    initial: BookRequest,
    torrents: Map<string, TorrentStatus> | null,
  ): Promise<BookRequest> {
    let request = initial
    for (const format of ["ebook", "audio"] as const) {
      if (torrents)
        request = await this.advanceDownload(request, format, torrents)
      if (torrents)
        request = await this.advanceImport(request, format, torrents)
    }
    request = await this.advanceSync(request)
    return request
  }

  private async advanceDownload(
    request: BookRequest,
    format: RequestFormat,
    torrents: Map<string, TorrentStatus>,
  ): Promise<BookRequest> {
    const fields = formatFields(request, format)
    if (fields.status !== "downloading" && fields.status !== "stalled") {
      return request
    }
    const name = FORMAT_NAMES[format]
    if (!fields.release || !fields.infohash) {
      return await this.failFormat(
        request,
        format,
        `${name}: no release chosen`,
      )
    }
    const now = this.now()
    const torrent = torrents.get(fields.infohash)

    if (!torrent) {
      // Not in the download client: never added, or added before a crash
      // and lost. Seeders go stale, so check again right before adding.
      const ref: ReleaseRef = {
        source: fields.release.source,
        id: fields.release.id,
        kind: format,
      }
      const fresh = await this.deps.adapter.inspect(ref)
      if (fresh.seeders < 1) {
        request = await this.update(
          request,
          prefixed(format, {
            status: "choosing",
            error: "No one is sharing this version right now",
          }),
          {
            kind: `${format}-choosing`,
            message: `${name}: the chosen version has no seeders; pick another`,
          },
        )
        return await this.reach(request, `${format}-choosing`)
      }
      const added = await this.deps.adapter.add(
        ref,
        fields.infohash,
        seedFolderFor(fields.release, fields.infohash),
      )
      return await this.update(
        request,
        prefixed(format, {
          addedAt: fields.addedAt ?? now,
          progressAt: now,
          reused: added.alreadyPresent,
          error: null,
        }),
        {
          kind: `${format}-added`,
          message: added.alreadyPresent
            ? `${name}: already downloading, using that copy`
            : `${name}: download started`,
        },
      )
    }

    // In the client although this request never added it (another request's
    // download, or a lost response to our own add): it costs no new download.
    const firstSeen: FormatPatch =
      fields.addedAt === null ? { addedAt: now, reused: true } : {}

    if (torrent.progress >= 1) {
      return await this.update(
        request,
        prefixed(format, {
          status: "importing",
          progress: 1,
          bytesDone: torrent.bytesDone,
          progressAt: now,
          ...firstSeen,
          error: null,
        }),
        { kind: `${format}-downloaded`, message: `${name}: download finished` },
      )
    }

    if (torrent.bytesDone > fields.bytesDone) {
      return await this.update(
        request,
        prefixed(format, {
          status: "downloading",
          progress: torrent.progress,
          bytesDone: torrent.bytesDone,
          progressAt: now,
          ...firstSeen,
          error: null,
        }),
        fields.status === "stalled"
          ? { kind: `${format}-resumed`, message: `${name}: downloading again` }
          : undefined,
      )
    }

    const since = fields.progressAt ?? fields.addedAt ?? now
    if (fields.status === "downloading" && now - since >= STALL_MS) {
      request = await this.update(
        request,
        prefixed(format, {
          status: "stalled",
          ...firstSeen,
          error: `No data for 30 minutes, ${torrent.seedersConnected} seeders connected`,
        }),
        {
          kind: `${format}-stalled`,
          message: `${name}: stalled, ${torrent.seedersConnected} seeders connected`,
        },
      )
      return await this.reach(request, `${format}-stalled`)
    }

    if (fields.addedAt === null) {
      return await this.update(request, prefixed(format, firstSeen))
    }
    return request
  }

  private async advanceImport(
    request: BookRequest,
    format: RequestFormat,
    torrents: Map<string, TorrentStatus>,
  ): Promise<BookRequest> {
    const fields = formatFields(request, format)
    if (fields.status !== "importing" || !fields.infohash) return request
    const torrent = torrents.get(fields.infohash)
    if (!torrent) return request

    const name = FORMAT_NAMES[format]
    try {
      const source = deliverySource(this.deps.seedDir, format, torrent)
      const delivered = await deliverFormat({
        bookUuid: request.bookUuid,
        collectionUuid: request.collectionUuid,
        userId: request.userId,
        format: format === "ebook" ? "ebook" : "audiobook",
        source,
      })
      request = await this.update(
        request,
        {
          ...prefixed(format, { status: "ready", error: null }),
          bookUuid: delivered.bookUuid,
        },
        {
          kind: `${format}-ready`,
          message:
            delivered.outcome === "joined-existing"
              ? `${name}: already in the library, added to your shelf`
              : `${name}: ready`,
        },
      )
      return await this.reach(request, "readable")
    } catch (error) {
      if (error instanceof DeliveryError && !error.retryable) {
        return await this.failFormat(
          request,
          format,
          `${name}: ${error.message}`,
        )
      }
      const message = error instanceof Error ? error.message : String(error)
      logger.warn({
        msg: "Importing a requested book failed; trying again on the next check",
        requestUuid: request.uuid,
        format,
        error: message,
      })
      return await this.update(request, prefixed(format, { error: message }))
    }
  }

  private async failFormat(
    request: BookRequest,
    format: RequestFormat,
    message: string,
  ): Promise<BookRequest> {
    const updated = await this.update(
      request,
      prefixed(format, { status: "failed", error: message }),
      { kind: `${format}-failed`, message },
    )
    return await this.reach(updated, `${format}-failed`)
  }

  /**
   * Once every requested format is in and the book has both an ebook and an
   * audiobook (one may have been on it already), follow the book's sync: the
   * one this request queued, an active one, or a new one. A sync that failed
   * or was cancelled is not queued again; retrying is the reader's call.
   *
   * A request stays on the Home card when it is done, offering the book,
   * until the reader opens or dismisses it.
   */
  private async advanceSync(request: BookRequest): Promise<BookRequest> {
    const wanted = [request.ebookStatus, request.audioStatus].filter(
      (status) => status !== "none",
    )
    if (!wanted.every((status) => status === "ready")) return request
    if (request.alignStatus === "done" || request.alignStatus === "failed") {
      return request
    }

    const book = await getBook(request.bookUuid)
    if (!isPresent(book?.ebook) || !isPresent(book?.audiobook)) return request

    let jobUuid = request.alignJobUuid
    let status: AlignStatus | null = null

    if (jobUuid) {
      const job = await getJob(jobUuid)
      if (job) status = ALIGN_STATUS_BY_JOB[job.status]
      else jobUuid = null
    }

    if (!jobUuid) {
      const latest = await getLatestJobForBook(request.bookUuid, "book_align")
      if (isPresent(book?.readaloud)) {
        status = "done"
      } else if (latest) {
        jobUuid = latest.uuid
        status = ALIGN_STATUS_BY_JOB[latest.status]
      } else {
        const job = await enqueueBookAlign(request.bookUuid, false)
        jobUuid = job.uuid
        status = ALIGN_STATUS_BY_JOB[job.status]
      }
    }

    if (status === null) return request
    if (status === request.alignStatus && jobUuid === request.alignJobUuid) {
      return request
    }

    const event: Partial<Record<AlignStatus, RequestEventInput>> = {
      queued: { kind: "sync-queued", message: "Narration sync queued" },
      syncing: { kind: "sync-started", message: "Syncing narration" },
      paused: { kind: "sync-paused", message: "Narration sync paused" },
      done: { kind: "sync-done", message: "Read-along ready" },
      failed: { kind: "sync-failed", message: "Narration sync failed" },
    }
    request = await this.update(
      request,
      {
        alignJobUuid: jobUuid,
        alignStatus: status,
      },
      event[status],
    )
    if (status === "done") return await this.reach(request, "synced")
    if (status === "failed") return await this.reach(request, "sync-failed")
    return request
  }
}
