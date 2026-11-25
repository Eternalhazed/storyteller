const MAX_RETRIES = 3
const REQUEST_TIMEOUT_MS = 12_000

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<undefined>()
  setTimeout(resolve, ms, undefined)
  return promise
}

class Pacer {
  private tail = Promise.resolve()
  private nextStart = 0

  constructor(private readonly interval: number) {}

  async take(): Promise<void> {
    const turn = this.tail.then(async () => {
      const wait = this.nextStart - performance.now()
      if (wait > 0) await delay(Math.ceil(wait))
      this.nextStart = performance.now() + this.interval
    })
    this.tail = turn
    await turn
  }
}

const pacers = {
  "api.audible.com": new Pacer(200),
  "openlibrary.org": new Pacer(1000),
}

function retryAfter(response: Response): number {
  const header = response.headers.get("retry-after")
  if (!header) return 0
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  return Math.max(0, Date.parse(header) - Date.now()) || 0
}

export async function requestCatalog<T>(
  url: URL,
  headers?: HeadersInit,
): Promise<T | null> {
  const host = url.hostname
  if (host !== "api.audible.com" && host !== "openlibrary.org") {
    throw new Error(`Unknown catalog host: ${host}`)
  }
  const pacer = pacers[host]

  for (let attempt = 0; ; attempt++) {
    await pacer.take()
    let response: Response
    try {
      response = await fetch(url, {
        ...(headers && { headers }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (response.ok) return (await response.json()) as T
    } catch (error) {
      // A malformed JSON response is not a network error.
      if (error instanceof SyntaxError || attempt === MAX_RETRIES) throw error
      await delay(250 * 2 ** attempt)
      continue
    }
    void response.body?.cancel().catch(() => undefined)
    if (response.status === 404) return null
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(`${url.hostname} returned HTTP ${response.status}`)
    }
    await delay(Math.max(250 * 2 ** attempt, retryAfter(response)))
  }
}
