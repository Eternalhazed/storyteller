import {
  type Xray,
  advanceByCharacters,
  chapterIndexForHref,
  ordinalAtProgression,
  ordinalAtTextOffset,
  ordinalOfFragment,
} from "@storyteller/xray/view"

import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"
import { type ReturnToPosition } from "@/store/slices/bookshelfSlice"

// A conservative fallback for sentence-fragment locators, in non-whitespace
// characters. A measured page bottom and layout progression need no extension.
export const XRAY_TEXT_PAGE_CHARACTERS = 1000

/** Reading on advances knowledge even if an old jump's return control remains. */
export function getXrayBoundary({
  xray,
  locator,
  mode,
  isPlaying = false,
  returnPosition,
}: {
  xray: Xray | null | undefined
  locator: ReadiumLocator | null | undefined
  mode: "text" | "audio"
  isPlaying?: boolean | undefined
  returnPosition?: ReturnToPosition | null | undefined
}): number {
  if (!xray) return -1
  const pageCharacters =
    mode === "text" && !isPlaying ? XRAY_TEXT_PAGE_CHARACTERS : 0
  return Math.max(
    boundaryAtLocator(xray, locator, pageCharacters),
    boundaryAtLocator(xray, returnPosition?.locator, pageCharacters),
  )
}

/**
 * Of the reader's position and the position a jump would return them to, the
 * one further into the book: the place they have actually read to.
 *
 * An X-Ray jump returns here. While hopping between old mentions that keeps
 * the reader's real place; after reading on past an old jump, it is where
 * they are now, not where that old jump started.
 */
export function getFurthestReadLocator(
  xray: Xray,
  locator: ReadiumLocator | null | undefined,
  returnPosition: ReturnToPosition | null | undefined,
): ReadiumLocator | undefined {
  const saved = returnPosition?.locator
  if (!saved || !locator) return saved ?? locator ?? undefined
  return boundaryAtLocator(xray, saved, 0) > boundaryAtLocator(xray, locator, 0)
    ? saved
    : locator
}

function boundaryAtLocator(
  xray: Xray,
  boundaryLocator: ReadiumLocator | null | undefined,
  pageCharacters: number,
): number {
  if (!boundaryLocator) return -1

  let chapterIndex = -1
  try {
    chapterIndex = chapterIndexForHref(xray, boundaryLocator.href)
  } catch {
    // A malformed href cannot anchor text offsets or layout progression.
  }
  const chapter = xray.chapters[chapterIndex]
  const textEnd = boundaryLocator.locations?.textEnd
  if (
    chapter?.lengths.length &&
    textEnd !== undefined &&
    Number.isFinite(textEnd) &&
    textEnd >= 0
  ) {
    return textEnd === 0
      ? -1
      : ordinalAtTextOffset(xray, chapterIndex, textEnd - 1) ?? -1
  }

  for (const fragment of boundaryLocator.locations?.fragments ?? []) {
    const ordinal = ordinalOfFragment(xray, fragment)
    if (ordinal !== null && ordinal >= 0) {
      return pageCharacters
        ? advanceByCharacters(xray, ordinal, pageCharacters)
        : ordinal
    }
  }

  const progression = boundaryLocator.locations?.progression
  if (
    !chapter?.lengths.length ||
    progression === undefined ||
    !Number.isFinite(progression)
  )
    return -1

  // Layout can already be ahead of the text (for example a long in-chapter
  // contents page). Never compound that fallback's error with a page allowance.
  return ordinalAtProgression(xray, chapterIndex, progression) ?? -1
}

/** Standalone audio locators have no aligned text position, even with an ebook. */
export function canUseXray({
  xray,
  format,
  mode,
}: {
  xray: Xray | null | undefined
  format: "readaloud" | "ebook" | "audiobook"
  mode: "text" | "audio"
}) {
  return !!xray?.entities.length && (mode !== "audio" || format === "readaloud")
}
