#!/usr/bin/env tsx
/**
 * A stand-in acquisition adapter for trying book requests locally, against a
 * folder of books you own. It "finds" every sub-folder of the seed root as a
 * release and reports any release it is asked to add as already downloaded.
 * Nothing is downloaded and nothing in the seed root is written.
 *
 *   SEED_DIR=/path/to/seed SECRET=dev-secret PORT=8090 \
 *     npx tsx scripts/fake-acquisition-adapter.ts
 *
 * Lay the seed root out the way a real adapter saves downloads:
 *   <seed>/local/<40 hex characters>/<files>
 * A folder holding an .epub is an ebook release; one holding audio files is
 * an audiobook release. Then point the server at it:
 *   STORYTELLER_ACQUISITION_URL=http://localhost:8090
 *   STORYTELLER_ACQUISITION_SECRET=dev-secret
 *   STORYTELLER_ACQUISITION_SEED_DIR=/path/to/seed
 */
/* eslint-disable no-console */
import { readdir, stat } from "node:fs/promises"
import { type IncomingMessage, createServer } from "node:http"
import { join, relative, sep } from "node:path"

const seedDir = process.env["SEED_DIR"]
const secret = process.env["SECRET"]
const port = Number(process.env["PORT"] ?? 8090)
if (!seedDir || !secret) {
  throw new Error("Set SEED_DIR and SECRET")
}

const SOURCE = "local"
const AUDIO = /\.(mp3|m4a|m4b|mp4|aac|ogg|opus|flac|wav)$/i

type File = { path: string; size: number }

async function listFiles(folder: string): Promise<File[]> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  })
  const files: File[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    files.push({
      path: relative(folder, path).split(sep).join("/"),
      size: (await stat(path)).size,
    })
  }
  return files
}

async function releases() {
  const root = join(seedDir ?? "", SOURCE)
  const hashes = await readdir(root).catch(() => [] as string[])
  const found = []
  for (const infohash of hashes.filter((name) => /^[0-9a-f]{40}$/.test(name))) {
    const files = await listFiles(join(root, infohash))
    const epub = files.some((file) => file.path.toLowerCase().endsWith(".epub"))
    const audio = files.filter((file) => AUDIO.test(file.path))
    const kind = epub ? "ebook" : audio.length ? "audio" : null
    if (!kind) continue
    const types = [
      ...new Set(
        files.map((file) => file.path.split(".").pop()?.toLowerCase() ?? ""),
      ),
    ].filter((type) => type === "epub" || AUDIO.test(`.${type}`))
    found.push({
      source: SOURCE,
      id: infohash,
      kind,
      title: files[0]?.path.split("/")[0] ?? infohash,
      authors: [],
      seeders: 5,
      size: files.reduce((sum, file) => sum + file.size, 0),
      infohash,
      files,
      facts: {
        narrators: null,
        abridged: null,
        dramatized: null,
        language: null,
        fileTypes: { value: types, source: "files" },
        bitrateKbps: null,
        durationSeconds: null,
        pack: null,
        series: null,
        publishedYear: null,
      },
    })
  }
  return found
}

async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  let text = ""
  for await (const chunk of request) text += String(chunk)
  return JSON.parse(text || "{}") as Record<string, unknown>
}

const added = new Set<string>()

createServer((request, response) => {
  void (async () => {
    const reply = (status: number, payload: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" })
      response.end(JSON.stringify(payload))
    }
    if (request.headers.authorization !== `Bearer ${secret}`) {
      reply(401, { message: "unauthorized" })
      return
    }
    const input = await body(request)
    const all = await releases()
    switch (request.url) {
      case "/v1/search":
        reply(200, {
          releases: all.filter((release) => release.kind === input["kind"]),
        })
        return
      case "/v1/inspect": {
        const ref = input["release"] as { id: string }
        const release = all.find((each) => each.id === ref.id)
        if (release) reply(200, { release })
        else reply(404, { message: "no such release" })
        return
      }
      case "/v1/add": {
        const infohash = String(input["infohash"])
        const alreadyPresent = added.has(infohash)
        added.add(infohash)
        console.log(`add ${infohash} into ${String(input["folder"])}`)
        reply(200, { infohash, alreadyPresent })
        return
      }
      case "/v1/status": {
        const wanted = input["infohashes"] as string[]
        reply(200, {
          torrents: all
            .filter(
              (release) =>
                wanted.includes(release.infohash) &&
                added.has(release.infohash),
            )
            .map((release) => ({
              infohash: release.infohash,
              progress: 1,
              bytesDone: release.size,
              seedersConnected: 3,
              state: "seeding",
              folder: `${SOURCE}/${release.infohash}`,
              files: release.files,
            })),
        })
        return
      }
      default:
        reply(404, { message: "unknown call" })
    }
  })().catch((error: unknown) => {
    console.error(error)
    response.writeHead(500)
    response.end()
  })
}).listen(port, () => {
  console.log(`Fake acquisition adapter on http://localhost:${port}`)
})
