import type {
  BookDownloadActivity,
  DownloadFormat,
} from "@/store/downloadLifecycle"

type FormatDownload = {
  downloadStatus:
    | "NONE"
    | "PAUSED"
    | "DOWNLOADING"
    | "ERROR"
    | "DOWNLOADED"
    | "QUEUED"
  downloadProgress: number
}

type DownloadBook = {
  uuid: string
  serverUuid: string | null
  ebook?: FormatDownload | null
  audiobook?: FormatDownload | null
  readaloud?: (FormatDownload & { status: string }) | null
}

export type BookDownloadState = {
  status:
    | "download"
    | "queued"
    | "downloading"
    | "preparing"
    | "cancelling"
    | "downloaded"
    | "failed"
  label: string
  action: "download" | "retry" | "cancel" | "remove" | null
  actionLabel: string | null
  canResume?: boolean
  progress: number | null
}

export const DOWNLOAD_FORMAT_LABEL: Record<DownloadFormat, string> = {
  ebook: "Ebook",
  audiobook: "Audiobook",
  readaloud: "Readaloud",
}

export function getBookDownloadState(
  book: DownloadBook,
  format: DownloadFormat,
  activity: BookDownloadActivity | null,
): BookDownloadState {
  const download = book[format]
  const active =
    activity?.bookUuid === book.uuid && activity.format === format
      ? activity
      : null
  const includedInReadaloud =
    format !== "readaloud" && book.readaloud?.downloadStatus === "DOWNLOADED"
  const canDownload =
    !!book.serverUuid &&
    !!download &&
    (format !== "readaloud" || book.readaloud?.status === "ALIGNED") &&
    !includedInReadaloud
  const progress =
    download && Number.isFinite(download.downloadProgress)
      ? Math.max(0, Math.min(100, Math.round(download.downloadProgress)))
      : 0

  if (active?.phase === "preparing") {
    return {
      status: "preparing",
      label: "Preparing",
      action: null,
      actionLabel: null,
      progress: null,
    }
  }
  if (active?.phase === "cancelling") {
    return {
      status: "cancelling",
      label: "Cancelling…",
      action: null,
      actionLabel: null,
      progress: null,
    }
  }
  if (active?.phase === "downloading") {
    return {
      status: "downloading",
      label: `Downloading ${progress}%`,
      action: "cancel",
      actionLabel: "Cancel download",
      progress,
    }
  }
  if (download?.downloadStatus === "DOWNLOADED") {
    return {
      status: "downloaded",
      label: "Available offline",
      action: "remove",
      actionLabel: book.serverUuid ? "Remove from device" : "Delete local book",
      progress: null,
    }
  }
  if (
    download?.downloadStatus === "QUEUED" ||
    download?.downloadStatus === "DOWNLOADING" ||
    download?.downloadStatus === "PAUSED"
  ) {
    // Pending records survive a restart, but native transfer tasks do not.
    return {
      status: "queued",
      label: "Queued",
      action: "cancel",
      actionLabel: "Cancel download",
      canResume: !activity && canDownload,
      progress: null,
    }
  }
  if (download?.downloadStatus === "ERROR") {
    return {
      status: "failed",
      label: "Failed",
      action: canDownload ? "retry" : null,
      actionLabel: canDownload ? "Try again" : null,
      progress: null,
    }
  }
  return {
    status: "download",
    label: canDownload
      ? "Download"
      : includedInReadaloud
        ? "Included in readaloud"
        : "Not available",
    action: canDownload ? "download" : null,
    actionLabel: canDownload ? "Download" : null,
    progress: null,
  }
}
