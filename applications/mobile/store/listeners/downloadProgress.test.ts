import assert from "node:assert/strict"
import { test } from "vitest"

import {
  createDownloadProgressHandler,
  getDownloadProgress,
} from "./downloadProgress"

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: globalThis,
})

const wait = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration))

test("cancels a queued progress update", async () => {
  let updateCount = 0
  const progress = createDownloadProgressHandler(async () => {
    updateCount += 1
  }, 10)

  progress.update()
  progress.update()
  progress.cancel()

  await wait(20)

  assert.equal(updateCount, 1)
})

test("prevents an in-flight progress update from replacing final state", async () => {
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  let releaseUpdate!: () => void
  const updateReleased = new Promise<void>((resolve) => {
    releaseUpdate = resolve
  })
  let cachedStatus = "DOWNLOADING"

  const progress = createDownloadProgressHandler(async (isActive) => {
    markStarted()
    await updateReleased
    if (!isActive()) return
    cachedStatus = "DOWNLOADING"
  }, 10)

  const inFlightUpdate = progress.update()
  await started

  progress.cancel()
  cachedStatus = "DOWNLOADED"
  releaseUpdate()
  await inFlightUpdate

  assert.equal(cachedStatus, "DOWNLOADED")
})

test("keeps transfer percentages finite when a response has no content length", () => {
  assert.equal(getDownloadProgress(0, 0), 0)
  assert.equal(getDownloadProgress(512, -1), 0)
  assert.equal(getDownloadProgress(512, Infinity), 0)
  assert.equal(getDownloadProgress(NaN, 1024), 0)
  assert.equal(getDownloadProgress(-1, 1024), 0)
  assert.equal(getDownloadProgress(2048, 1024), 100)
  assert.equal(getDownloadProgress(128, 1024), 13)
})
