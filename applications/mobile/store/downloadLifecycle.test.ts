import assert from "node:assert/strict"
import { test } from "vitest"

import {
  type DownloadQueueResult,
  createDownloadLifecycle,
  createDownloadQueue,
} from "./downloadLifecycle"

const ebook = { bookUuid: "book", format: "ebook" } as const
const audiobook = { bookUuid: "book", format: "audiobook" } as const

test("only one format owns the download lifecycle at a time", () => {
  const lifecycle = createDownloadLifecycle()
  const task = lifecycle.begin(ebook)!
  assert.equal(lifecycle.begin(audiobook), null)
  task.finish()
  assert.equal(lifecycle.active, null)
  assert.ok(lifecycle.begin(audiobook))
})

test("cancellation waits for both the native writer and task settlement before deleting files", async () => {
  const lifecycle = createDownloadLifecycle()
  const task = lifecycle.begin(ebook)!
  const stopped = Promise.withResolvers<void>()
  const events: string[] = []
  task.setCancelTransfer(() => {
    events.push("native cancellation requested")
    return stopped.promise
  })
  const cancellation = lifecycle.cancel(
    ebook,
    async () => {
      events.push("files removed")
    },
    () => events.push("cancelling"),
  )

  assert.equal(task.isCancelled(), true)
  assert.equal(task.prepare(), false)
  await Promise.resolve()
  assert.deepEqual(events, ["cancelling", "native cancellation requested"])
  task.finish()
  await Promise.resolve()
  assert.equal(events.includes("files removed"), false)
  stopped.resolve()
  assert.equal(await cancellation, true)
  assert.equal(events.at(-1), "files removed")
})

test("extraction and parsing cannot be cancelled or have their files removed", async () => {
  const lifecycle = createDownloadLifecycle()
  const task = lifecycle.begin(ebook)!
  assert.equal(task.prepare(), true)
  let touched = false
  const cancelled = await lifecycle.cancel(
    ebook,
    async () => {
      touched = true
    },
    () => {
      touched = true
    },
  )
  assert.equal(cancelled, false)
  assert.equal(touched, false)
  assert.equal(task.phase, "preparing")
  assert.equal(lifecycle.active, task)
  task.finish()
})

test("cancelling a queued format reserves it without touching another active format", async () => {
  const lifecycle = createDownloadLifecycle()
  const active = lifecycle.begin(ebook)!
  const removed = Promise.withResolvers<void>()
  const cancellation = lifecycle.cancel(
    audiobook,
    () => removed.promise,
    () => {},
  )
  assert.equal(active.phase, "downloading")
  assert.equal(lifecycle.isCancelling(audiobook), true)
  active.finish()
  assert.equal(lifecycle.begin(audiobook), null)
  removed.resolve()
  await cancellation
  assert.ok(lifecycle.begin(audiobook))
})

test("cancellation during setup prevents preparation even before a native task exists", async () => {
  const lifecycle = createDownloadLifecycle()
  const task = lifecycle.begin(ebook)!
  let filesRemoved = false
  const cancellation = lifecycle.cancel(
    ebook,
    async () => {
      filesRemoved = true
    },
    () => {},
  )
  assert.equal(task.isCancelled(), true)
  assert.equal(task.prepare(), false)
  assert.equal(filesRemoved, false)
  task.finish()
  await cancellation
  assert.equal(filesRemoved, true)
})

test("even synchronous native cancellation failure cannot remove files before settlement", async () => {
  const lifecycle = createDownloadLifecycle()
  const task = lifecycle.begin(ebook)!
  const error = new Error("native cancellation failed")
  task.setCancelTransfer(() => {
    throw error
  })
  let filesRemoved = false
  const cancellation = lifecycle.cancel(
    ebook,
    async () => {
      filesRemoved = true
    },
    () => {},
  )
  const rejected = assert.rejects(cancellation, error)
  await Promise.resolve()
  assert.equal(filesRemoved, false)
  task.finish()
  await rejected
  assert.equal(filesRemoved, true)
  assert.equal(lifecycle.isCancelling(ebook), false)
})

test("duplicate cancellation cannot race a second file cleanup", async () => {
  const lifecycle = createDownloadLifecycle()
  const task = lifecycle.begin(ebook)!
  let removals = 0
  const cancellation = lifecycle.cancel(
    ebook,
    async () => {
      removals += 1
    },
    () => {},
  )
  assert.equal(
    await lifecycle.cancel(
      ebook,
      async () => {
        removals += 1
      },
      () => {},
    ),
    false,
  )
  task.finish()
  await cancellation
  assert.equal(removals, 1)
})

test("an enqueue during an empty SELECT is latched and re-queried before going idle", async () => {
  const selected = Promise.withResolvers<DownloadQueueResult>()
  let scans = 0
  let downloads = 0
  const wake = createDownloadQueue<void>(async () => {
    scans += 1
    if (scans === 1) return selected.promise
    if (scans === 2) {
      downloads += 1
      return "processed"
    }
    return "empty"
  })
  const draining = wake(undefined, true)
  await wake(undefined, true)
  assert.equal(scans, 1)
  selected.resolve("empty")
  await draining
  assert.equal(scans, 3)
  assert.equal(downloads, 1)
})

test("queued cancellation cleanup wakes a drain that observed its blocked target", async () => {
  const selected = Promise.withResolvers<DownloadQueueResult>()
  let scans = 0
  const wake = createDownloadQueue<void>(async () => {
    scans += 1
    if (scans === 1) return selected.promise
    return scans === 2 ? "processed" : "empty"
  })
  const draining = wake(undefined, true)
  // The cancellation finishes while the old row selection is still pending.
  await wake(undefined)
  selected.resolve("blocked")
  await draining
  assert.equal(scans, 3)
})

test("cancelling pending records after a restart does not implicitly resume the queue", async () => {
  let scans = 0
  const wake = createDownloadQueue<void>(async () => {
    scans += 1
    return "empty"
  })
  await wake(undefined)
  assert.equal(scans, 0)
  await wake(undefined, true)
  assert.equal(scans, 1)
  await wake(undefined)
  assert.equal(scans, 1)
  await wake(undefined, true)
  assert.equal(scans, 2)
})
