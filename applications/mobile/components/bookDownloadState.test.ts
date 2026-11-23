import assert from "node:assert/strict"
import { test } from "vitest"

import { getBookDownloadState } from "./bookDownloadState"

const book = {
  uuid: "book",
  serverUuid: "server",
  ebook: { downloadStatus: "NONE", downloadProgress: 0 },
} as const

const transfer = {
  bookUuid: book.uuid,
  format: "ebook",
  phase: "downloading",
} as const

test("100% transfer remains cancellable downloading until the runtime starts preparing", () => {
  const downloadedBytes = {
    ...book,
    ebook: { downloadStatus: "DOWNLOADING", downloadProgress: 100 },
  } as const
  const transferring = getBookDownloadState(downloadedBytes, "ebook", transfer)
  assert.equal(transferring.label, "Downloading 100%")
  assert.equal(transferring.action, "cancel")

  const preparing = getBookDownloadState(downloadedBytes, "ebook", {
    ...transfer,
    phase: "preparing",
  })
  assert.equal(preparing.label, "Preparing")
  assert.equal(preparing.action, null)
  assert.equal(preparing.progress, null)
})

test("preparing follows the runtime even when the final progress callback was not 100%", () => {
  const state = getBookDownloadState(
    {
      ...book,
      ebook: { downloadStatus: "DOWNLOADING", downloadProgress: 72 },
    },
    "ebook",
    { ...transfer, phase: "preparing" },
  )
  assert.equal(state.status, "preparing")
  assert.equal(state.action, null)
})

test("pending records after a restart are queued with an explicit resume action", () => {
  for (const downloadStatus of ["QUEUED", "DOWNLOADING", "PAUSED"] as const) {
    const pending = {
      ...book,
      ebook: { downloadStatus, downloadProgress: 100 },
    }
    const state = getBookDownloadState(pending, "ebook", null)
    assert.equal(state.actionLabel, "Cancel download")
    assert.equal(state.canResume, true)
    assert.equal(state.label, "Queued")
    assert.equal(state.progress, null)
  }
})

test("a queued format can be cancelled without cancelling the other active book", () => {
  const state = getBookDownloadState(
    {
      ...book,
      ebook: { downloadStatus: "QUEUED", downloadProgress: 0 },
    },
    "ebook",
    { ...transfer, bookUuid: "another-book" },
  )
  assert.equal(state.label, "Queued")
  assert.equal(state.action, "cancel")
})

test("only parsed and downloaded formats are available offline", () => {
  const state = getBookDownloadState(
    {
      ...book,
      ebook: { downloadStatus: "DOWNLOADED", downloadProgress: 100 },
    },
    "ebook",
    null,
  )
  assert.equal(state.label, "Available offline")
  assert.equal(state.action, "remove")

  const preparing = getBookDownloadState(
    {
      ...book,
      ebook: { downloadStatus: "DOWNLOADED", downloadProgress: 100 },
    },
    "ebook",
    { ...transfer, phase: "preparing" },
  )
  assert.equal(preparing.status, "preparing")
  assert.equal(preparing.action, null)
})

test("failed formats offer retry while cancellation never offers another action", () => {
  const state = getBookDownloadState(
    {
      ...book,
      ebook: { downloadStatus: "ERROR", downloadProgress: 83 },
    },
    "ebook",
    null,
  )
  assert.equal(state.label, "Failed")
  assert.equal(state.actionLabel, "Try again")

  const cancelling = getBookDownloadState(book, "ebook", {
    ...transfer,
    phase: "cancelling",
  })
  assert.equal(cancelling.label, "Cancelling…")
  assert.equal(cancelling.action, null)
})

test("progress is finite and bounded", () => {
  for (const [downloadProgress, expected] of [
    [NaN, 0],
    [Infinity, 0],
    [-1, 0],
    [101, 100],
    [12.6, 13],
  ]) {
    const state = getBookDownloadState(
      {
        ...book,
        ebook: { ...book.ebook, downloadProgress: downloadProgress! },
      },
      "ebook",
      transfer,
    )
    assert.equal(state.progress, expected)
  }
})

test("local-only and unavailable formats cannot offer downloads or retries", () => {
  assert.equal(
    getBookDownloadState({ ...book, serverUuid: null }, "ebook", null).action,
    null,
  )
  assert.equal(
    getBookDownloadState(
      {
        ...book,
        serverUuid: null,
        ebook: { downloadStatus: "ERROR", downloadProgress: 0 },
      },
      "ebook",
      null,
    ).action,
    null,
  )

  const readaloud = {
    ...book,
    readaloud: {
      status: "ALIGNED",
      downloadStatus: "DOWNLOADED",
      downloadProgress: 100,
    },
  } as const
  assert.equal(getBookDownloadState(readaloud, "ebook", null).action, null)
  assert.equal(
    getBookDownloadState(
      {
        ...readaloud,
        readaloud: {
          ...readaloud.readaloud,
          status: "PROCESSING",
          downloadStatus: "NONE",
        },
      },
      "readaloud",
      null,
    ).action,
    null,
  )
  const localDownload = getBookDownloadState(
    {
      ...book,
      serverUuid: null,
      ebook: { downloadStatus: "DOWNLOADED", downloadProgress: 100 },
    },
    "ebook",
    null,
  )
  assert.equal(localDownload.label, "Available offline")
  assert.equal(localDownload.actionLabel, "Delete local book")
})
