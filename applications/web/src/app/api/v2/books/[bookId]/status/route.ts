import { withHasPermission } from "@/auth/auth"
import { updateStatusForBooks } from "@/database/statuses"
import { logger } from "@/logging"
import { bookStatusChanged, currentStatus } from "@/recommendations/triggers"
import { type UUID } from "@/uuid"

type Params = Promise<{ bookId: UUID }>

export const PUT = withHasPermission<Params>("bookDownload")(async (
  request,
  context,
) => {
  const { bookId } = await context.params
  const body = (await request.json()) as {
    status: UUID | null
  }

  const { status } = body
  const userId = request.auth.user.id
  const previous = await currentStatus(userId, bookId)

  await updateStatusForBooks(status ?? null, [bookId], userId)

  // Only this single-book route counts as finishing a book; bulk changes
  // (and imports) never start a recommendation round.
  bookStatusChanged(userId, bookId, previous, status ?? null).catch(
    (error: unknown) => {
      logger.warn({ msg: "Failed to note a finished book", error })
    },
  )

  return new Response(null, { status: 204 })
})
