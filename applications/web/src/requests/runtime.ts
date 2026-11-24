import { logger } from "@/logging"

import { type AcquisitionConfig, getAcquisitionConfig } from "./adapter"
import { RequestEngine } from "./engine"
import { sendRequestNotification } from "./push"

/** How often active requests are advanced. */
const TICK_MS = 15_000

type Runtime = AcquisitionConfig & {
  engine: RequestEngine
  ticking: Promise<void> | null
  /** Passes asked for so far; a pass covers every ask made before it began. */
  asked: number
}

declare global {
  // Survives Next.js loading this module more than once.
  // eslint-disable-next-line no-var
  var bookRequestRuntime: Runtime | null | undefined
}

/**
 * The configured acquisition adapter and the engine that uses it, or null
 * when requests are not set up on this server.
 */
export function getRequestRuntime(): Runtime | null {
  if (globalThis.bookRequestRuntime !== undefined) {
    return globalThis.bookRequestRuntime
  }
  const config = getAcquisitionConfig()
  globalThis.bookRequestRuntime = config && {
    ...config,
    engine: new RequestEngine({
      adapter: config.adapter,
      seedDir: config.seedDir,
      notify: sendRequestNotification,
    }),
    ticking: null,
    asked: 0,
  }
  return globalThis.bookRequestRuntime
}

/**
 * Advance requests now, without overlapping a pass already running: a call
 * during a pass gets one more pass after it.
 */
export function advanceRequests(): Promise<void> {
  const runtime = getRequestRuntime()
  if (!runtime) return Promise.resolve()
  runtime.asked++
  runtime.ticking ??= (async () => {
    let covered = 0
    while (covered < runtime.asked) {
      covered = runtime.asked
      try {
        await runtime.engine.tick()
      } catch (error) {
        logger.error({
          msg: "Failed to advance book requests",
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    // cleared in the same step as the last check, so no ask is missed
    runtime.ticking = null
  })()
  return runtime.ticking
}

/** Started once at server start; picks up every open request from its stored state. */
export function startRequestTicker(): void {
  if (!getRequestRuntime()) return
  void advanceRequests()
  setInterval(() => void advanceRequests(), TICK_MS).unref()
  logger.info("Book requests are on")
}
