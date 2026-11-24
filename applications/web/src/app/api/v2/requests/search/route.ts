import { NextResponse } from "next/server"
import { z } from "zod"

import { withHasPermission } from "@/auth/auth"
import {
  UuidSchema,
  WorkSchema,
  disabledResponse,
  parseBody,
  requestErrorResponse,
} from "@/requests/http"
import { findLibraryCopies, getEditionNarrators } from "@/requests/library"
import { rankReleases, recommendPair } from "@/requests/ranking"
import { getRequestRuntime } from "@/requests/runtime"

export const dynamic = "force-dynamic"

/**
 * @summary Find releases of a book for the request picker
 * @desc Returns the copies of the book already in the library (yours, and
 *       ones only on other shelves), every ebook and audiobook release with
 *       flags, best first, and one recommended pair with the reasons for it.
 *       Releases nobody is sharing are left out. Pass `seriesUuid` to prefer
 *       the edition of your other books in that series.
 */
export const POST = withHasPermission("bookRead")(async (request) => {
  const runtime = getRequestRuntime()
  if (!runtime) return disabledResponse()
  const body = await parseBody(
    request,
    z.object({
      work: WorkSchema,
      seriesUuid: UuidSchema.nullable().optional(),
    }),
  )
  if (!body.ok) return body.response
  const userId = request.auth.user.id
  const { work, seriesUuid } = body.data

  try {
    const [library, editionNarrators, ebookReleases, audioReleases] =
      await Promise.all([
        findLibraryCopies(work, userId),
        getEditionNarrators(userId, seriesUuid),
        runtime.adapter.search(work, "ebook"),
        runtime.adapter.search(work, "audio"),
      ])
    const context = { work, editionNarrators }
    const ebooks = rankReleases(ebookReleases, "ebook", context)
    const audios = rankReleases(audioReleases, "audio", context)
    return NextResponse.json({
      library,
      ebooks,
      audios,
      recommendation: recommendPair(ebooks, audios, context),
    })
  } catch (error) {
    return requestErrorResponse(error)
  }
})
