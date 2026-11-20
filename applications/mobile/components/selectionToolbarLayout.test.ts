import assert from "node:assert/strict"
import { test } from "vitest"

import { getSelectionToolbarLayout } from "./selectionToolbarLayout"

const viewport = {
  topInset: 24,
  width: 400,
  x: 200,
  y: 300,
}

test("centers a single-row toolbar above the selection", () => {
  assert.deepEqual(getSelectionToolbarLayout({ ...viewport, actionCount: 6 }), {
    height: 40,
    left: 80,
    top: 252,
    width: 240,
  })
})

test("keeps the toolbar inside the horizontal inset near either edge", () => {
  assert.deepEqual(
    getSelectionToolbarLayout({ ...viewport, actionCount: 6, x: 390 }),
    { height: 40, left: 144, top: 252, width: 240 },
  )
  assert.deepEqual(
    getSelectionToolbarLayout({ ...viewport, actionCount: 6, x: 5 }),
    { height: 40, left: 16, top: 252, width: 240 },
  )
})

test("clamps to the top safe area for selections near the top", () => {
  assert.deepEqual(
    getSelectionToolbarLayout({ ...viewport, actionCount: 6, y: 50 }),
    { height: 40, left: 80, top: 24, width: 240 },
  )
})

test("wraps only when the window is narrower than the actions", () => {
  assert.deepEqual(
    getSelectionToolbarLayout({
      actionCount: 6,
      topInset: 0,
      width: 232,
      x: 116,
      y: 300,
    }),
    { height: 80, left: 16, top: 212, width: 200 },
  )
})

test("sizes new-selection and highlight actions with and without X-Ray", () => {
  for (const actionCount of [5, 6, 7]) {
    const width = actionCount * 40
    assert.deepEqual(getSelectionToolbarLayout({ ...viewport, actionCount }), {
      height: 40,
      left: 200 - width / 2,
      top: 252,
      width,
    })
  }
})

test("wraps the optional X-Ray action without leaving a partial row uncounted", () => {
  for (const actionCount of [6, 7]) {
    assert.deepEqual(
      getSelectionToolbarLayout({
        ...viewport,
        actionCount,
        width: 232,
        x: 116,
      }),
      { height: 80, left: 16, top: 212, width: 200 },
    )
  }
  assert.deepEqual(
    getSelectionToolbarLayout({
      ...viewport,
      actionCount: 7,
      width: 174,
      x: 87,
    }),
    { height: 120, left: 16, top: 172, width: 142 },
  )
})
