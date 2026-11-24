import { NextResponse } from "next/server"

import { MediaType } from "@storyteller/media-types"

import { hasPermission, withHasPermission } from "@/auth/auth"
import { isBookVisibleTo } from "@/database/books"
import { subscribeToBookEvents } from "@/events"
import { subscribeToJobEvents } from "@/jobEvents"

export const dynamic = "force-dynamic"

const HEARTBEAT_INTERVAL_MS = 10_000

/**
 * @summary Subscribe to library updates
 * @desc Server-sent events for every channel the caller may read. Each message
 *       is `{ channel, event }`, where channel is "book" or "job".
 */
export const GET = withHasPermission(["bookList", "bookProcess"])((request) => {
  if (request.headers.get("Accept") !== MediaType.EVENT_STREAM.mime) {
    return new NextResponse(null, { status: 405 })
  }

  const user = request.auth.user
  const canReadBooks = hasPermission("bookList", user)
  const canReadJobs = hasPermission("bookProcess", user)

  const encoder = new TextEncoder()
  const unsubscribes: (() => void)[] = []
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let teardown = () => {}

  const readable = new ReadableStream({
    start(controller) {
      let closed = false

      teardown = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = null
        for (const unsubscribe of unsubscribes) unsubscribe()
        unsubscribes.length = 0
      }

      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          teardown()
        }
      }

      send(`: connected\n\n`)
      heartbeat = setInterval(() => {
        send(`event: ping\ndata: {}\n\n`)
      }, HEARTBEAT_INTERVAL_MS)

      if (canReadBooks) {
        // A reader only hears about books on shelves they can see. The checks
        // are chained so events still arrive in the order they happened. A
        // deletion carries only the book's id and cannot be checked anymore.
        let delivered = Promise.resolve()
        unsubscribes.push(
          subscribeToBookEvents((event) => {
            delivered = delivered
              .then(async () => {
                if (
                  event.type !== "bookDeleted" &&
                  !(await isBookVisibleTo(event.bookUuid, user.id))
                ) {
                  return
                }
                send(`data: ${JSON.stringify({ channel: "book", event })}\n\n`)
              })
              // a failed check drops that event, never the ones after it
              .catch(() => {})
          }),
        )
      }

      if (canReadJobs) {
        unsubscribes.push(
          subscribeToJobEvents((event) => {
            send(`data: ${JSON.stringify({ channel: "job", event })}\n\n`)
          }),
        )
      }
    },
    cancel() {
      teardown()
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type": `${MediaType.EVENT_STREAM.mime}; charset=utf-8`,
      Connection: "keep-alive",
      "Cache-Control": "no-cache, no-transform",
      "Content-Encoding": "none",
    },
  })
})
