import { throttle } from "@/throttle"

export function getDownloadProgress(bytesWritten: number, totalBytes: number) {
  if (
    !Number.isFinite(bytesWritten) ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0
  ) {
    return 0
  }
  const percent = Math.round((bytesWritten / totalBytes) * 100)
  return Math.max(0, Math.min(100, percent))
}

export function createDownloadProgressHandler<A extends unknown[], R>(
  updateProgress: (isActive: () => boolean, ...args: A) => R,
  delay: number,
) {
  let active = true
  const isActive = () => active
  const update = throttle((...args: A) => {
    if (!active) return
    return updateProgress(isActive, ...args)
  }, delay)

  return {
    update,
    cancel() {
      active = false
      update.cancel()
    },
  }
}
