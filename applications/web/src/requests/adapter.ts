import { readFileSync } from "node:fs"

import { z } from "zod"

import { env } from "@/env"

import {
  type ChosenWork,
  REQUEST_FORMATS,
  type Release,
  type RequestFormat,
  type TorrentStatus,
} from "./types"

/** Names one release at its source. */
export type ReleaseRef = Pick<Release, "source" | "id" | "kind">

/**
 * A private service that finds and downloads releases. It only searches,
 * inspects a release, adds one to the download client and reports progress;
 * every decision about whose shelf a book goes on stays in this server.
 */
export interface AcquisitionAdapter {
  search(work: ChosenWork, kind: RequestFormat): Promise<Release[]>
  /** Fresh details for one release: seeders, infohash and file list. */
  inspect(release: ReleaseRef): Promise<Release>
  /**
   * Add the release to the download client, saving into `folder` under the
   * seed root. Adding one that is already there returns its infohash.
   */
  add(
    release: ReleaseRef,
    infohash: string,
    folder: string,
  ): Promise<{ infohash: string; alreadyPresent: boolean }>
  /** Torrents the client has, of the given hashes; unknown ones are left out. */
  status(infohashes: string[]): Promise<TorrentStatus[]>
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = "AdapterError"
  }
}

function fact<T extends z.ZodType>(value: T) {
  return z
    .object({ value, source: z.enum(["field", "files"]) })
    .nullable()
    .default(null)
}

const FileSchema = z.object({ path: z.string(), size: z.number() })

const ReleaseSchema = z.object({
  source: z.string().min(1),
  id: z.string().min(1),
  kind: z.enum(REQUEST_FORMATS),
  title: z.string(),
  authors: z.array(z.string()).default([]),
  seeders: z.number().int().min(0),
  size: z.number().nullable().default(null),
  infohash: z
    .string()
    .regex(/^[0-9a-fA-F]{40}$/)
    .transform((hash) => hash.toLowerCase())
    .nullable()
    .default(null),
  files: z.array(FileSchema).nullable().default(null),
  facts: z.object({
    narrators: fact(z.array(z.string())),
    abridged: fact(z.boolean()),
    dramatized: fact(z.boolean()),
    language: fact(z.string()),
    fileTypes: fact(z.array(z.string())),
    bitrateKbps: fact(z.number()),
    durationSeconds: fact(z.number()),
    pack: fact(z.boolean()),
    series: fact(
      z.object({ name: z.string(), position: z.number().nullable() }),
    ),
    publishedYear: fact(z.number()),
  }),
}) satisfies z.ZodType<Release>

const TorrentStatusSchema = z.object({
  infohash: z
    .string()
    .regex(/^[0-9a-fA-F]{40}$/)
    .transform((hash) => hash.toLowerCase()),
  progress: z.number().min(0).max(1),
  bytesDone: z.number().min(0),
  seedersConnected: z.number().int().min(0),
  state: z.enum([
    "downloading",
    "seeding",
    "paused",
    "checking",
    "error",
    "queued",
  ]),
  folder: z.string().nullable(),
  files: z.array(FileSchema),
}) satisfies z.ZodType<TorrentStatus>

const TIMEOUT_MS = 30_000

/** Talks to the adapter over HTTP with a shared secret. */
export class HttpAcquisitionAdapter implements AcquisitionAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T extends z.ZodType>(
    path: string,
    body: unknown,
    schema: T,
  ): Promise<z.output<T>> {
    const url = new URL(
      path,
      this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`,
    )
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.secret}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw new AdapterError(
        `The acquisition adapter could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      throw new AdapterError(
        `The acquisition adapter answered ${response.status} to ${path}`,
        response.status,
      )
    }
    const parsed = schema.safeParse(await response.json())
    if (!parsed.success) {
      throw new AdapterError(
        `The acquisition adapter sent an unexpected ${path} response: ${z.prettifyError(parsed.error)}`,
      )
    }
    return parsed.data
  }

  async search(work: ChosenWork, kind: RequestFormat): Promise<Release[]> {
    const { releases } = await this.call(
      "v1/search",
      { work, kind },
      z.object({ releases: z.array(ReleaseSchema) }),
    )
    return releases
  }

  async inspect(release: ReleaseRef): Promise<Release> {
    const { release: inspected } = await this.call(
      "v1/inspect",
      { release },
      z.object({ release: ReleaseSchema }),
    )
    return inspected
  }

  async add(
    release: ReleaseRef,
    infohash: string,
    folder: string,
  ): Promise<{ infohash: string; alreadyPresent: boolean }> {
    return await this.call(
      "v1/add",
      { release, infohash, folder },
      z.object({
        infohash: z.string().transform((hash) => hash.toLowerCase()),
        alreadyPresent: z.boolean(),
      }),
    )
  }

  async status(infohashes: string[]): Promise<TorrentStatus[]> {
    if (!infohashes.length) return []
    const { torrents } = await this.call(
      "v1/status",
      { infohashes },
      z.object({ torrents: z.array(TorrentStatusSchema) }),
    )
    return torrents
  }
}

export type AcquisitionConfig = {
  adapter: AcquisitionAdapter
  /** Where this server sees the adapter's download folder, read-only. */
  seedDir: string
}

/**
 * The configured adapter, or null when requests are not set up. With no
 * adapter, every request control is hidden.
 */
export function getAcquisitionConfig(): AcquisitionConfig | null {
  const url = env.STORYTELLER_ACQUISITION_URL
  const seedDir = env.STORYTELLER_ACQUISITION_SEED_DIR
  const secret =
    env.STORYTELLER_ACQUISITION_SECRET ??
    (env.STORYTELLER_ACQUISITION_SECRET_FILE
      ? readFileSync(env.STORYTELLER_ACQUISITION_SECRET_FILE, "utf-8").trim()
      : undefined)
  if (!url || !seedDir || !secret) return null
  return { adapter: new HttpAcquisitionAdapter(url, secret), seedDir }
}
