import { type FinishPromptPreferences } from "@/database/preferencesTypes"
import {
  type ReadiumLocator,
  type StorytellerTrack,
} from "@/modules/readium/src/Readium.types"

export type FinishBook = {
  status?: { name: string } | null
  position?: { locator: ReadiumLocator } | null
}

/** Audio state is supplied only for the book currently playing as audio. */
export type FinishAudioPosition = {
  tracks: readonly Pick<StorytellerTrack, "relativeUri" | "duration">[]
  trackIndex?: number
  position?: number
}

export function getProgress(
  locator: ReadiumLocator | null | undefined,
): number {
  const progress = locator?.locations?.totalProgression
  return typeof progress === "number" && Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0
}

export function shouldAutoStart(
  book: FinishBook,
  preferences: Pick<FinishPromptPreferences, "autoStartReading">,
): boolean {
  return (
    preferences.autoStartReading &&
    book.status?.name === "To read" &&
    getProgress(book.position?.locator) >= 0.02
  )
}

/** Unknown track lengths or positions must not make a book look finished. */
export function getAudioRemainingSeconds(
  locator: ReadiumLocator | null | undefined,
  audio: FinishAudioPosition,
): number | null {
  if (
    !audio.tracks.length ||
    audio.tracks.some(
      (track) => !Number.isFinite(track.duration) || track.duration <= 0,
    )
  ) {
    return null
  }

  let trackIndex = audio.trackIndex
  let position = audio.position
  if (locator?.type.startsWith("audio/")) {
    trackIndex = audio.tracks.findIndex(
      (track) => track.relativeUri === locator.href,
    )
    const fragment = locator.locations?.fragments?.find((value) =>
      value.startsWith("t="),
    )
    const seconds = fragment ? Number.parseFloat(fragment.slice(2)) : NaN
    position = Number.isFinite(seconds)
      ? seconds
      : locator.locations?.progression !== undefined
        ? (audio.tracks[trackIndex]?.duration ?? NaN) *
          locator.locations.progression
        : undefined
  }

  if (
    trackIndex === undefined ||
    !Number.isInteger(trackIndex) ||
    trackIndex < 0 ||
    trackIndex >= audio.tracks.length ||
    position === undefined ||
    !Number.isFinite(position) ||
    position < 0 ||
    position > audio.tracks[trackIndex]!.duration
  ) {
    return null
  }

  let remaining = audio.tracks[trackIndex]!.duration - position
  for (let index = trackIndex + 1; index < audio.tracks.length; index++) {
    remaining += audio.tracks[index]!.duration
  }
  return remaining
}

export function shouldFinish(
  book: FinishBook,
  threshold: number,
  audio?: FinishAudioPosition,
): boolean {
  if (book.status?.name === "Read") return false
  if (getProgress(book.position?.locator) >= threshold) return true
  if (!audio) return false

  const remaining = getAudioRemainingSeconds(book.position?.locator, audio)
  return remaining !== null && remaining <= 10 * 60
}

/** A dismissal lasts until another whole percentage point has been read. */
export function canPromptAfterDismissal(
  progress: number,
  dismissedProgress: number | undefined,
): boolean {
  return (
    dismissedProgress === undefined ||
    progress + Number.EPSILON >= dismissedProgress + 0.01
  )
}

/** The one-time cleanup uses 90%, independently of the live finish setting. */
export function looksFinished<Book extends FinishBook>(
  books: readonly Book[],
  threshold = 0.9,
): Book[] {
  return books.filter(
    (book) =>
      book.status?.name === "Reading" &&
      getProgress(book.position?.locator) >= threshold,
  )
}
