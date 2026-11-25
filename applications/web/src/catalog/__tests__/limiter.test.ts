import { afterEach, expect, it, vi } from "vitest"

import { requestCatalog } from "@/catalog/limiter"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it("paces both catalog hosts independently and retries 429 using Retry-After", async () => {
  vi.useFakeTimers()
  const requests: Record<string, number[]> = {}
  const fetch = vi.fn((url: URL) => {
    const times = (requests[url.hostname] ??= [])
    times.push(performance.now())
    if (url.hostname === "api.audible.com" && times.length === 1) {
      return Promise.resolve(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "1" },
        }),
      )
    }
    return Promise.resolve(Response.json({ ok: true }))
  })
  vi.stubGlobal("fetch", fetch)

  const audible = new URL("https://api.audible.com/1.0/catalog/products")
  const ol = new URL("https://openlibrary.org/search.json")
  const result = Promise.all([
    requestCatalog(audible),
    requestCatalog(audible),
    requestCatalog(ol),
    requestCatalog(ol),
  ])
  await vi.runAllTimersAsync()
  expect(await result).toEqual(Array(4).fill({ ok: true }))
  expect(requests["api.audible.com"]).toEqual([0, 200, 1000])
  expect(requests["openlibrary.org"]).toEqual([0, 1000])
  expect(fetch.mock.calls).toHaveLength(5)
})
