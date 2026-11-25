import { upsertManualItem } from "@/database/readingHistory"
import { type PickRow, getPick, updatePick } from "@/database/recommendations"
import { getStatuses, updateStatusForBooks } from "@/database/statuses"
import { setUserBookRating } from "@/database/userRatings"
import { findWorkInLibrary } from "@/requests/library"
import { type UUID } from "@/uuid"

import { sqlTime } from "./clock"
import { type ReaderPickState } from "./types"

const DAY_MS = 86_400_000

export class PickError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = "PickError"
  }
}

function inDays(days: number): string {
  return sqlTime(Date.now() + days * DAY_MS)
}

function shortDate(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

/** The reader's library copy of a pick's book, if they have one. */
async function libraryCopy(userId: UUID, pick: PickRow): Promise<UUID | null> {
  const [book] = await findWorkInLibrary(pick.work, userId)
  return book?.uuid ?? null
}

/**
 * Change what the reader wants done with a pick. "Already read" records the
 * read where it belongs: on the library book when they have it, otherwise as
 * an in-app history entry that no import replaces.
 */
export async function setPickState(
  userId: UUID,
  uuid: UUID,
  state: ReaderPickState,
  options: { reason?: string | null; rating?: number | null } = {},
): Promise<PickRow> {
  const pick = await getPick(userId, uuid)
  if (!pick) throw new PickError("No such recommendation", 404, "not-found")
  if (pick.state === "requested") {
    throw new PickError("This book was already requested", 409, "requested")
  }
  const rating =
    options.rating == null ? null : Math.max(0, Math.min(5, options.rating))

  switch (state) {
    case "new":
      await updatePick(uuid, { state, stateReason: null, restedUntil: null })
      break
    case "saved":
      await updatePick(uuid, { state, restedUntil: null })
      break
    case "not_now":
      await updatePick(uuid, { state, restedUntil: inDays(56) })
      break
    case "not_for_me":
      await updatePick(uuid, {
        state,
        stateReason: options.reason?.slice(0, 200) ?? null,
      })
      break
    case "not_found":
      await updatePick(uuid, {
        state,
        restedUntil: inDays(28),
        note: `Not found on ${shortDate()}`,
      })
      break
    case "already_read": {
      const bookUuid = await libraryCopy(userId, pick)
      if (bookUuid) {
        const read = (await getStatuses()).find(
          (status) => status.name.toLowerCase() === "read",
        )
        if (read) await updateStatusForBooks(read.uuid, [bookUuid], userId)
        if (rating != null)
          await setUserBookRating(userId, bookUuid, { rating })
      } else {
        await upsertManualItem(
          userId,
          {
            key: pick.work.key,
            title: pick.work.title,
            authors: pick.work.authors,
            series: pick.work.series
              ? [
                  {
                    key: "",
                    name: pick.work.series.name,
                    position: pick.work.series.position,
                  },
                ]
              : [],
            subjects: [],
            releaseDate: pick.work.releaseDate,
            narrators: pick.work.narrators,
            runtimeMinutes: pick.work.runtimeMinutes,
          },
          rating,
        )
      }
      await updatePick(uuid, {
        state,
        stateReason: rating != null ? String(rating) : null,
      })
      break
    }
  }
  const updated = await getPick(userId, uuid)
  if (!updated) throw new PickError("No such recommendation", 404, "not-found")
  return updated
}
