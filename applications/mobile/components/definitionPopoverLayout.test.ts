import assert from "node:assert/strict"
import { test } from "vitest"

import { getDefinitionPopoverLayout } from "./definitionPopoverLayout"

// Fire HD 10 portrait in dp.
const tablet = { bottomInset: 24, height: 1371, topInset: 24, width: 857 }
const phone = { bottomInset: 24, height: 914, topInset: 48, width: 411 }

test("floats a capped-width card above a selection on tablets", () => {
  assert.deepEqual(getDefinitionPopoverLayout({ ...tablet, x: 300, y: 900 }), {
    bottom: 471,
    left: 100,
    maxHeight: 360,
    width: 400,
  })
})

test("keeps the card inside the edge inset", () => {
  assert.deepEqual(getDefinitionPopoverLayout({ ...tablet, x: 840, y: 900 }), {
    bottom: 471,
    left: 441,
    maxHeight: 360,
    width: 400,
  })
})

test("drops below a selection near the top and shrinks to fit", () => {
  assert.deepEqual(getDefinitionPopoverLayout({ ...phone, x: 200, y: 150 }), {
    left: 16,
    maxHeight: 360,
    top: 214,
    width: 379,
  })
  assert.deepEqual(
    getDefinitionPopoverLayout({ ...phone, height: 500, x: 200, y: 150 }),
    { left: 16, maxHeight: 246, top: 214, width: 379 },
  )
})

test("avoids a cramped space above in favor of a roomier one below", () => {
  assert.deepEqual(getDefinitionPopoverLayout({ ...phone, x: 200, y: 260 }), {
    left: 16,
    maxHeight: 360,
    top: 324,
    width: 379,
  })
})

test("stays above a low selection even when the card must shrink", () => {
  assert.deepEqual(
    getDefinitionPopoverLayout({ ...phone, height: 500, x: 200, y: 400 }),
    { bottom: 100, left: 16, maxHeight: 336, width: 379 },
  )
})
