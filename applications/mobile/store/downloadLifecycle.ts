export type DownloadFormat = "ebook" | "audiobook" | "readaloud"

export type DownloadTarget = {
  bookUuid: string
  format: DownloadFormat
}

export type DownloadPhase = "downloading" | "preparing" | "cancelling"

export type BookDownloadActivity = DownloadTarget & {
  phase: DownloadPhase
}

export type DownloadTask = DownloadTarget & {
  readonly phase: DownloadPhase
  isCancelled: () => boolean
  setCancelTransfer: (cancel: () => Promise<unknown>) => void
  prepare: () => boolean
  cancel: () => Promise<unknown>
  finish: () => void
}

export function createDownloadLifecycle() {
  let active: DownloadTask | null = null
  const cancelling = new Set<string>()
  const key = (target: DownloadTarget) => `${target.bookUuid}:${target.format}`

  function begin(target: DownloadTarget): DownloadTask | null {
    if (active || cancelling.has(key(target))) return null

    let phase: DownloadPhase = "downloading"
    let cancelTransfer: (() => Promise<unknown>) | undefined
    // Native Promise implementations do not all support Promise.withResolvers.
    let resolveSettled!: () => void
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })

    const task: DownloadTask = {
      ...target,
      get phase() {
        return phase
      },
      isCancelled() {
        return phase === "cancelling"
      },
      setCancelTransfer(cancel: () => Promise<unknown>) {
        cancelTransfer = cancel
      },
      prepare() {
        if (phase !== "downloading") return false
        phase = "preparing"
        return true
      },
      cancel() {
        phase = "cancelling"
        if (!cancelTransfer) return settled
        return Promise.resolve()
          .then(() => cancelTransfer!())
          .finally(() => settled)
      },
      finish() {
        if (active === task) active = null
        resolveSettled()
      },
    }
    active = task
    return task
  }

  return {
    begin,
    get active() {
      return active
    },
    isCancelling(target: DownloadTarget) {
      return cancelling.has(key(target))
    },
    async cancel(
      target: DownloadTarget,
      removeFiles: () => Promise<void>,
      onCancelling: () => void,
    ) {
      const ownsTarget =
        active?.bookUuid === target.bookUuid && active.format === target.format
      const task = ownsTarget ? active : null
      if (task?.phase === "preparing") return false
      if (cancelling.has(key(target))) return false

      // Reserve queued targets too, so the queue cannot start one during cleanup.
      cancelling.add(key(target))
      try {
        onCancelling()
        try {
          if (task) await task.cancel()
        } finally {
          // The task settles before cancellation resolves, even if native
          // cancellation fails, so no writer still owns these files.
          await removeFiles()
        }
        return true
      } finally {
        cancelling.delete(key(target))
      }
    },
  }
}

export const downloadLifecycle = createDownloadLifecycle()

export type DownloadQueueResult = "processed" | "empty" | "blocked"

export function createDownloadQueue<Context>(
  processNext: (context: Context) => Promise<DownloadQueueResult>,
) {
  let running = false
  let enabled = false
  let generation = 0

  return async (context: Context, resume = false) => {
    if (resume) enabled = true
    generation += 1
    if (!enabled || running) return

    running = true
    try {
      while (true) {
        const observedGeneration = generation
        const result = await processNext(context)
        if (result === "processed") continue
        // An enqueue or completed cancellation may have changed the rows while
        // the SELECT was in flight. Never discard that wake-up at a terminal edge.
        if (observedGeneration !== generation) continue
        if (result === "empty") enabled = false
        break
      }
    } finally {
      running = false
    }
  }
}
