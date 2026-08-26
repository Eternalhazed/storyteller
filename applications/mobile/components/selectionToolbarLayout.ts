export const SELECTION_TOOLBAR_ACTION_SIZE = 40

const EDGE_INSET = 16
const SELECTION_GAP = 8

type Input = {
  actionCount: number
  collapsedActionCount: number
  topInset: number
  width: number
  x: number
  y: number
}

export function getSelectionToolbarLayout({
  actionCount,
  collapsedActionCount,
  topInset,
  width,
  x,
  y,
}: Input) {
  const availableWidth = width - EDGE_INSET * 2
  const toolbarWidth = Math.min(
    actionCount * SELECTION_TOOLBAR_ACTION_SIZE,
    availableWidth,
  )
  const toolbarHeight =
    Math.ceil(
      (actionCount * SELECTION_TOOLBAR_ACTION_SIZE) / toolbarWidth,
    ) * SELECTION_TOOLBAR_ACTION_SIZE
  const collapsedWidth = Math.min(
    collapsedActionCount * SELECTION_TOOLBAR_ACTION_SIZE,
    availableWidth,
  )
  const collapsedLeft = clamp(
    x - collapsedWidth / 2,
    EDGE_INSET,
    width - EDGE_INSET - collapsedWidth,
  )
  const left = clamp(
    collapsedLeft + collapsedWidth - toolbarWidth,
    EDGE_INSET,
    width - EDGE_INSET - toolbarWidth,
  )
  const topAboveSelection = y - toolbarHeight - SELECTION_GAP

  return {
    height: toolbarHeight,
    left,
    top: Math.max(topAboveSelection, topInset),
    width: toolbarWidth,
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(value, maximum))
}
