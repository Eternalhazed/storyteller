const EDGE_INSET = 16
const MAX_WIDTH = 400
const MAX_HEIGHT = 360
// Reader selection events report a point 16dp above the selection's top edge;
// placing the popover below must also clear the selected line itself.
const BELOW_SELECTION_OFFSET = 64

type Input = {
  bottomInset: number
  height: number
  topInset: number
  width: number
  x: number
  y: number
}

export type DefinitionPopoverLayout = {
  left: number
  maxHeight: number
  width: number
} & ({ bottom: number } | { top: number })

/**
 * Floats a compact card next to the selection: above it (growing upward)
 * when the full card fits there or above is the roomier side, otherwise
 * below. Width is capped so tablets get a popover, not a full-width panel.
 */
export function getDefinitionPopoverLayout({
  bottomInset,
  height,
  topInset,
  width,
  x,
  y,
}: Input): DefinitionPopoverLayout {
  const popoverWidth = Math.min(MAX_WIDTH, width - EDGE_INSET * 2)
  const left = Math.max(
    EDGE_INSET,
    Math.min(x - popoverWidth / 2, width - EDGE_INSET - popoverWidth),
  )
  const top = y + BELOW_SELECTION_OFFSET
  const spaceAbove = y - topInset - EDGE_INSET
  const spaceBelow = height - top - bottomInset - EDGE_INSET

  if (spaceAbove >= Math.min(MAX_HEIGHT, spaceBelow)) {
    return {
      bottom: height - y,
      left,
      maxHeight: Math.min(MAX_HEIGHT, spaceAbove),
      width: popoverWidth,
    }
  }

  return {
    left,
    maxHeight: Math.min(MAX_HEIGHT, spaceBelow),
    top,
    width: popoverWidth,
  }
}
