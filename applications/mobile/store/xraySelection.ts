import {
  type Xray,
  type XrayEntityView,
  findEntity,
  viewXray,
} from "@storyteller-platform/xray/view"

import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"

import { getXrayBoundary } from "./xrayBoundary"

export type XraySelection = {
  boundary: number
  entity: XrayEntityView
}

/** A selection can establish that its own sentence has been read, not later text. */
export function getSelectionXray({
  xray,
  readerBoundary,
  readerLocator,
  selection,
}: {
  xray: Xray | null | undefined
  readerBoundary: number
  readerLocator?: ReadiumLocator | null | undefined
  selection: ReadiumLocator | null | undefined
}): XraySelection | null {
  const text = selection?.text?.highlight
  if (!xray?.entities.length || !selection || !text?.trim()) return null
  const boundary = getXraySelectionBoundary({
    xray,
    readerBoundary,
    readerLocator,
    selection,
  })
  const entity = findEntity(viewXray(xray, boundary), text)
  return entity ? { boundary, entity } : null
}

export function getXraySelectionBoundary({
  xray,
  readerBoundary,
  readerLocator,
  selection,
}: {
  xray: Xray | null | undefined
  readerBoundary: number
  readerLocator?: ReadiumLocator | null | undefined
  selection: ReadiumLocator | null | undefined
}) {
  if (!xray || !selection) return readerBoundary
  // A selection on the measured viewport cannot establish knowledge beyond
  // that page. Its layout progression may be many pages ahead of its text.
  if (readerLocator?.locations?.textEnd !== undefined) return readerBoundary
  const progression = selection.locations?.progression
  const selectionOrdinal =
    progression === undefined
      ? -1
      : getXrayBoundary({
          xray,
          locator: {
            href: selection.href,
            type: selection.type,
            locations: { progression },
          },
          mode: "audio",
        })
  return Math.max(readerBoundary, selectionOrdinal)
}

export function getXraySelectionFacts(entity: XrayEntityView) {
  return [...entity.facts].sort((a, b) => b.sentence - a.sentence).slice(0, 2)
}
