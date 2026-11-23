import { expect, test } from "vitest"

import { serverPositionUpdated } from "@/store/actions"
import { type UUID } from "@/uuid"

import { type PassageContext, passageSlice } from "./passageSlice"

const bookUuid = "e80a3778-5a7b-470e-bca9-2f74d3d3bc28" as UUID
const reader: PassageContext = { bookUuid, format: "ebook", surface: "text" }
const listener: PassageContext = {
  bookUuid,
  format: "readaloud",
  surface: "audio",
}
const chapter = (number: number) => ({
  href: `chapter${number}.xhtml`,
  type: "application/xhtml+xml",
})
const { actions, reducer } = passageSlice

function openReference(context: PassageContext = reader) {
  const request = actions.jump({
    ...context,
    origin: chapter(19),
    purpose: "reference",
    target: { locator: chapter(8) },
  })
  const requested = reducer(undefined, request)
  return reducer(
    requested,
    actions.moveCompleted({
      id: request.payload.id,
      viewport: { locator: chapter(8) },
    }),
  )
}

test("repeated jumps and preview page turns never replace the first return anchor", () => {
  const arrived = openReference()
  const browsing = reducer(
    arrived,
    actions.viewportChanged({ context: reader, locator: chapter(9) }),
  )
  const second = actions.jump({
    ...reader,
    origin: chapter(9),
    purpose: "chapter",
    target: { locator: chapter(12) },
  })
  const requested = reducer(browsing, second)
  const moved = reducer(
    requested,
    actions.moveCompleted({
      id: second.payload.id,
      viewport: { locator: chapter(12) },
    }),
  )
  const result = reducer(moved, actions.command(reader, "return"))
  expect(result.navigation?.move?.target).toEqual({ locator: chapter(19) })
  expect(result.navigation?.viewport.locator).toEqual(chapter(12))
  expect(result.navigation?.preview).toBe(true)
})

test("a failed return and a stale native completion do not clear the anchor", () => {
  const back = actions.command(reader, "return")
  const requested = reducer(openReference(), back)
  const failed = reducer(requested, actions.moveFailed({ id: back.payload.id }))
  const retry = actions.command(reader, "retry")
  const retrying = reducer(failed, retry)
  const stale = reducer(
    retrying,
    actions.moveCompleted({
      id: back.payload.id,
      viewport: { locator: chapter(19) },
    }),
  )
  expect(stale.navigation?.move?.id).toBe(retry.payload.id)
  expect(stale.navigation?.anchor.locator).toEqual(chapter(19))
  expect(
    reducer(
      stale,
      actions.moveCompleted({
        id: retry.payload.id,
        viewport: { locator: chapter(19) },
      }),
    ).navigation,
  ).toBeNull()
})

test("Continue here targets the page actually browsed, not the first preview target", () => {
  const browsing = reducer(
    openReference(),
    actions.viewportChanged({ context: reader, locator: chapter(9) }),
  )
  const keep = actions.command(reader, "continue")
  const pending = reducer(browsing, keep)
  expect(pending.navigation?.move?.target).toEqual({ locator: chapter(9) })
  expect(pending.navigation?.anchor.locator).toEqual(chapter(19))
  expect(
    reducer(
      pending,
      actions.moveCompleted({
        id: keep.payload.id,
        viewport: { locator: chapter(9) },
      }),
    ).navigation,
  ).toBeNull()
})

test("a newer remote position is offered only after returning from a preview", () => {
  const a = { bookUuid, locator: chapter(25), timestamp: 2000 }
  const b = { bookUuid, locator: chapter(20), timestamp: 1000 }
  const queued = reducer(
    reducer(openReference(), serverPositionUpdated(a)),
    serverPositionUpdated(b),
  )
  expect(
    reducer(queued, actions.command(reader, "remote")).navigation?.move,
  ).toBeNull()
  expect(queued.navigation?.viewport.locator).toEqual(chapter(8))

  const back = actions.command(reader, "return")
  const returning = reducer(queued, back)
  const atOrigin = reducer(
    returning,
    actions.moveCompleted({
      id: back.payload.id,
      viewport: { locator: chapter(19) },
    }),
  )
  const choosing = reducer(atOrigin, actions.command(reader, "remote"))
  expect(choosing.navigation?.move?.target).toEqual({ locator: chapter(25) })
})

test("a normal chapter jump is not provisional but offers undo", () => {
  const jump = actions.jump({
    ...reader,
    origin: chapter(1),
    purpose: "chapter",
    target: { locator: chapter(3) },
  })
  const moving = reducer(undefined, jump)
  const arrived = reducer(
    moving,
    actions.moveCompleted({
      id: jump.payload.id,
      viewport: { locator: chapter(3) },
    }),
  )
  expect(arrived.navigation?.preview).toBe(false)
  expect(
    reducer(arrived, actions.command(reader, "return")).navigation?.move
      ?.target,
  ).toEqual({ locator: chapter(1) })
})

test("leaving listening mode restores the exact track and timestamp before clearing the preview", () => {
  const jump = actions.jump({
    ...listener,
    origin: chapter(19),
    purpose: "reference",
    target: { locator: chapter(8) },
  })
  const pending = reducer(undefined, jump)
  const origin = {
    locator: chapter(19),
    audio: { relativeUri: "track-4.m4b", seconds: 1234.567 },
  }
  const captured = reducer(
    pending,
    actions.originCaptured({ id: jump.payload.id, origin }),
  )
  const previewing = reducer(
    captured,
    actions.moveCompleted({
      id: jump.payload.id,
      viewport: { locator: chapter(8) },
    }),
  )
  expect(
    reducer(previewing, actions.command(reader, "leave")).navigation,
  ).toEqual(previewing.navigation)
  const leaving = reducer(previewing, actions.command(listener, "leave"))
  expect(leaving.navigation?.move).toMatchObject({
    purpose: "leave",
    target: origin,
  })
})
