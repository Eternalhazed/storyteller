import assert from "node:assert/strict"
import test from "node:test"

import { XRAY_SCHEMA_VERSION, type Xray } from "@storyteller-platform/xray/view"

import {
  XRAY_CACHE_METADATA_FILE,
  type XrayCacheFiles,
  readXrayCache,
  readXrayCacheMetadata,
  shouldDeleteBookXray,
  writeXrayCache,
} from "./xrayCache"

const xray: Xray = {
  schemaVersion: XRAY_SCHEMA_VERSION,
  generator: { version: 1, model: "test" },
  source: { sha256: "test" },
  chapters: [],
  entities: [],
  segments: [],
  sentences: {},
}

function storage() {
  const contents = new Map<string, string>()
  const reads: string[] = []
  let next = 0
  let failingWrite: string | null = null
  const files: XrayCacheFiles = {
    async read(name) {
      reads.push(name)
      const value = contents.get(name)
      if (value === undefined) throw new Error("Missing file")
      return value
    },
    async write(name, value) {
      if (name === failingWrite) throw new Error("Disk write failed")
      contents.set(name, value)
    },
    async remove(name) {
      contents.delete(name)
    },
    newDataFile: () => `xray-${++next}.json`,
  }
  return {
    files,
    contents,
    reads,
    failWrite: (name: string | null) => {
      failingWrite = name
    },
  }
}

test("ETag checks read only the tiny sidecar, never the large index", async () => {
  const { files, reads, contents } = storage()
  await writeXrayCache(files, { json: JSON.stringify(xray), etag: '"book-v1"' })
  reads.length = 0
  const metadata = await readXrayCacheMetadata(files)
  assert.equal(metadata!.etag, '"book-v1"')
  assert.equal(metadata!.schemaVersion, XRAY_SCHEMA_VERSION)
  assert.equal(metadata!.supported, true)
  assert.deepEqual(reads, [XRAY_CACHE_METADATA_FILE])
  assert.ok(contents.get(XRAY_CACHE_METADATA_FILE)!.length < 256)
})

test("unsupported server versions retain their ETag without repeatedly parsing the index", async () => {
  const { files, reads } = storage()
  const newer = { ...xray, schemaVersion: XRAY_SCHEMA_VERSION + 1 }
  assert.equal(
    await writeXrayCache(files, {
      json: JSON.stringify(newer),
      etag: '"future-v2"',
    }),
    null,
  )
  reads.length = 0
  const metadata = await readXrayCacheMetadata(files)
  assert.equal(metadata!.etag, '"future-v2"')
  assert.equal(metadata!.schemaVersion, XRAY_SCHEMA_VERSION + 1)
  assert.equal(metadata!.supported, false)
  assert.equal(await readXrayCache(files), null)
  assert.deepEqual(reads, [XRAY_CACHE_METADATA_FILE, XRAY_CACHE_METADATA_FILE])
})

test("metadata commits the JSON and ETag as one generation", async () => {
  const { files, contents } = storage()
  const result = await writeXrayCache(files, {
    json: JSON.stringify(xray),
    etag: '"first"',
  })
  assert.deepEqual(result, xray)
  const first = (await readXrayCacheMetadata(files))!
  const next = { ...xray, source: { sha256: "second" } }
  await writeXrayCache(files, { json: JSON.stringify(next), etag: '"second"' })
  const second = (await readXrayCacheMetadata(files))!
  assert.notEqual(first.file, second.file)
  assert.equal(second.etag, '"second"')
  assert.deepEqual(await readXrayCache(files), next)
  assert.equal(contents.has(first.file), false)
})

test("a failed metadata commit leaves the old JSON and ETag together", async () => {
  const { files, contents, failWrite } = storage()
  await writeXrayCache(files, { json: JSON.stringify(xray), etag: '"first"' })
  const before = (await readXrayCacheMetadata(files))!
  failWrite(XRAY_CACHE_METADATA_FILE)
  await assert.rejects(
    writeXrayCache(files, {
      json: JSON.stringify({ ...xray, source: { sha256: "new" } }),
      etag: '"second"',
    }),
    /Disk write failed/u,
  )
  assert.deepEqual(await readXrayCacheMetadata(files), before)
  assert.deepEqual(await readXrayCache(files), xray)
  assert.equal(contents.size, 2)
})

test("a failed JSON write cannot publish a new ETag", async () => {
  const { files, failWrite } = storage()
  await writeXrayCache(files, { json: JSON.stringify(xray), etag: '"first"' })
  const before = await readXrayCacheMetadata(files)
  failWrite("xray-2.json")
  await assert.rejects(
    writeXrayCache(files, { json: JSON.stringify(xray), etag: '"second"' }),
  )
  assert.deepEqual(await readXrayCacheMetadata(files), before)
  assert.deepEqual(await readXrayCache(files), xray)
})

test("invalid responses do not replace a valid cached generation", async () => {
  const { files } = storage()
  await writeXrayCache(files, { json: JSON.stringify(xray), etag: '"first"' })
  const before = await readXrayCacheMetadata(files)
  for (const json of [
    "<html>error</html>",
    "null",
    "{}",
    '{"schemaVersion":"future"}',
  ]) {
    await assert.rejects(writeXrayCache(files, { json, etag: '"bad"' }))
    assert.deepEqual(await readXrayCacheMetadata(files), before)
  }
})

test("missing, malformed, and path-traversing metadata do not expose other files", async () => {
  const { files, contents, reads } = storage()
  assert.equal(await readXrayCache(files), null)
  assert.deepEqual(reads, [XRAY_CACHE_METADATA_FILE])
  contents.set(XRAY_CACHE_METADATA_FILE, "not json")
  assert.equal(await readXrayCacheMetadata(files), null)
  contents.set(
    XRAY_CACHE_METADATA_FILE,
    JSON.stringify({
      etag: '"bad"',
      schemaVersion: XRAY_SCHEMA_VERSION,
      supported: true,
      file: "../private.json",
    }),
  )
  assert.equal(await readXrayCacheMetadata(files), null)
  assert.ok(!reads.includes("../private.json"))
})

test("removing or cancelling one format preserves X-Ray when either text download remains", () => {
  for (const format of ["ebook", "readaloud", "audiobook"] as const) {
    assert.equal(
      shouldDeleteBookXray(format, { ebook: { downloadStatus: "DOWNLOADED" } }),
      false,
    )
    assert.equal(
      shouldDeleteBookXray(format, {
        readaloud: { downloadStatus: "DOWNLOADED" },
      }),
      false,
    )
  }
})

test("whole-book removal and removal of the final text format delete X-Ray", () => {
  assert.equal(
    shouldDeleteBookXray(undefined, {
      ebook: { downloadStatus: "DOWNLOADED" },
    }),
    true,
  )
  for (const format of ["ebook", "readaloud", "audiobook"] as const) {
    assert.equal(shouldDeleteBookXray(format, null), true)
    assert.equal(
      shouldDeleteBookXray(format, {
        ebook: { downloadStatus: "NONE" },
        readaloud: { downloadStatus: "QUEUED" },
      }),
      true,
    )
  }
})
