import assert from "node:assert/strict"
import test from "node:test"

import { getSelectionToolbarLayout } from "./selectionToolbarLayout"

const viewport = {
  topInset: 24,
  width: 400,
  x: 200,
  y: 300,
}

test("places the collapsed toolbar above the selection", () => {
  assert.deepEqual(
    getSelectionToolbarLayout({
      ...viewport,
      actionCount: 7,
      collapsedActionCount: 7,
    }),
    { height: 40, left: 60, top: 252, width: 280 },
  )
})

test("expands left from the collapsed toolbar's right edge", () => {
  assert.deepEqual(
    getSelectionToolbarLayout({
      ...viewport,
      actionCount: 8,
      collapsedActionCount: 7,
    }),
    { height: 40, left: 20, top: 252, width: 320 },
  )
})

test("clamps a wide existing-highlight toolbar to the top inset", () => {
  assert.deepEqual(
    getSelectionToolbarLayout({
      actionCount: 9,
      collapsedActionCount: 7,
      topInset: 40,
      width: 375,
      x: 200,
      y: 90,
    }),
    { height: 80, left: 16, top: 40, width: 343 },
  )
})
