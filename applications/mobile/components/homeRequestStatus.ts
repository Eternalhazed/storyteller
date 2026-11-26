import { type RequestView } from "@storyteller/web/src/requests/http"

type Stage = { label: string; percent?: number }

export function homeRequestStatus({
  ebook,
  audio,
  sync,
}: Pick<RequestView, "ebook" | "audio" | "sync">): Stage {
  switch (sync.status) {
    case "done":
      return { label: "Read-along ready" }
    case "queued":
      return { label: "Syncing narration" }
    case "syncing": {
      if (!sync.stage && sync.progress === 0) {
        return { label: "Syncing narration" }
      }
      const percent = Math.round(sync.progress * 100)
      return { label: `Syncing narration ${percent}%`, percent }
    }
    case "paused":
      return { label: "Narration sync paused" }
    case "failed":
      return { label: "Narration sync failed" }
  }

  if (ebook.status === "downloading" || audio.status === "downloading") {
    const progress =
      ebook.status === "downloading" && audio.status === "downloading"
        ? (ebook.progress + audio.progress) / 2
        : ebook.status === "downloading"
          ? ebook.progress
          : audio.progress
    const percent = Math.round(progress * 100)
    return { label: `Downloading ${percent}%`, percent }
  }
  if (ebook.status === "importing" || audio.status === "importing") {
    return { label: "Adding to your library" }
  }
  if (ebook.status === "choosing" || audio.status === "choosing") {
    return { label: "Release selection needed" }
  }
  if (ebook.status === "stalled" || audio.status === "stalled") {
    return { label: "Download stalled" }
  }
  if (ebook.status === "failed" || audio.status === "failed") {
    return { label: "Could not get a format" }
  }
  if (ebook.status === "ready") return { label: "Ready to read" }
  if (audio.status === "ready") return { label: "Ready to listen" }
  return { label: "Request pending" }
}
