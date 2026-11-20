export const SELECTION_TOOLBAR_ACTION_SIZE = 40

const EDGE_INSET = 16
const SELECTION_GAP = 8

type Input = {
  actionCount: number
  topInset: number
  width: number
  x: number
  y: number
}

/**
 * Centers the toolbar over the selection, keeps it inside the horizontal
 * inset, and places it above the selection (clamped to the top safe area).
 * Rows only wrap when the window is too narrow for every action.
 */
export function getSelectionToolbarLayout({
  actionCount,
  topInset,
  width,
  x,
  y,
}: Input) {
  const contentWidth = actionCount * SELECTION_TOOLBAR_ACTION_SIZE
  const toolbarWidth = Math.min(
    contentWidth,
    Math.max(width - EDGE_INSET * 2, SELECTION_TOOLBAR_ACTION_SIZE),
  )
  const actionsPerRow = Math.max(
    1,
    Math.floor(toolbarWidth / SELECTION_TOOLBAR_ACTION_SIZE),
  )
  const toolbarHeight =
    Math.ceil(actionCount / actionsPerRow) * SELECTION_TOOLBAR_ACTION_SIZE

  return {
    height: toolbarHeight,
    left: Math.max(
      EDGE_INSET,
      Math.min(x - toolbarWidth / 2, width - EDGE_INSET - toolbarWidth),
    ),
    top: Math.max(y - toolbarHeight - SELECTION_GAP, topInset),
    width: toolbarWidth,
  }
}
