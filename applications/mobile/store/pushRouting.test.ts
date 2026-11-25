import assert from "node:assert/strict"
import { test } from "vitest"

import { pushDestination } from "./pushRouting"

const REQUEST = "00000000-0000-4000-8000-000000000001"
const PICK = "00000000-0000-4000-8000-000000000002"

test("preserves request taps even when the payload also has a recommendation", () => {
  const route = { pathname: "/request/[uuid]", params: { uuid: REQUEST } }
  assert.deepEqual(pushDestination({ requestUuid: REQUEST }), route)
  assert.deepEqual(
    pushDestination({ requestUuid: REQUEST, recommendationUuid: PICK }),
    route,
  )
})

test("routes recommendation taps through the notification ownership check", () => {
  const route = {
    pathname: "/recommendations/pick/[uuid]",
    params: { uuid: PICK, notification: "true" },
  }
  assert.deepEqual(pushDestination({ recommendationUuid: PICK }), route)
  assert.deepEqual(
    pushDestination({ requestUuid: {}, recommendationUuid: PICK }),
    route,
  )
})

test("ignores unknown and invalid notification payloads", () => {
  assert.equal(pushDestination(undefined), null)
  assert.equal(
    pushDestination({ requestUuid: "old", recommendationUuid: "invalid" }),
    null,
  )
})
