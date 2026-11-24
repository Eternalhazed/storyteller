import {
  type FormatView,
  type RequestView,
} from "@storyteller/web/src/requests/http"
import { type RequestFormat } from "@storyteller/web/src/requests/types"

export const REQUEST_FORMAT_LABEL: Record<RequestFormat, string> = {
  ebook: "Ebook",
  audio: "Audiobook",
}

export function canPickRequestRelease(status: FormatView["status"]) {
  return status === "choosing" || status === "stalled" || status === "failed"
}

const percent = (progress: number) => `${Math.round(progress * 100)}%`

function describeFormat(format: RequestFormat, view: FormatView) {
  const label = REQUEST_FORMAT_LABEL[format]
  switch (view.status) {
    case "downloading":
      return `${label} ${percent(view.progress)}`
    case "importing":
      return `Adding to your library: ${label.toLowerCase()}`
    case "choosing":
      return `${label} needs your pick`
    case "stalled":
      return `${label} stalled`
    case "failed":
      return `${label} failed`
    case "ready":
    case "none":
      return null
  }
}

export function getRequestCard({
  work,
  ebook,
  audio,
  sync,
  complete,
}: Pick<RequestView, "work" | "ebook" | "audio" | "sync" | "complete">) {
  const bothDownloading =
    ebook.status === "downloading" && audio.status === "downloading"
  const primary =
    sync.status === "done"
      ? "Open read-along"
      : ebook.status === "ready"
        ? "Read ebook now"
        : audio.status === "ready"
          ? "Listen now"
          : null

  const status: string[] = []
  const pick: RequestFormat[] = []
  for (const [format, view] of [
    ["ebook", ebook],
    ["audio", audio],
  ] as const) {
    if (!bothDownloading) {
      const label = describeFormat(format, view)
      if (label) status.push(label)
    }
    if (canPickRequestRelease(view.status)) pick.push(format)
  }
  if (bothDownloading)
    status.push(percent((ebook.progress + audio.progress) / 2))

  switch (sync.status) {
    case "queued":
      status.push("Syncing narration")
      break
    case "syncing":
      status.push(
        sync.stage || sync.progress > 0
          ? `Syncing narration ${percent(sync.progress)}`
          : "Syncing narration",
      )
      break
    case "paused":
      status.push("Narration sync paused")
      break
    case "failed":
      status.push("Narration sync failed")
      break
  }

  return {
    title: bothDownloading ? `Getting ${work.title}` : work.title,
    primary,
    status: status.join(" · "),
    pick,
    retrySync: sync.status === "failed",
    dismissOnOpen: primary !== null && complete === true,
  }
}
