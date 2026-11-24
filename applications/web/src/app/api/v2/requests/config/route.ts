import { NextResponse } from "next/server"
import { z } from "zod"

import { withHasPermission } from "@/auth/auth"
import { db } from "@/database/connection"
import { UuidSchema, parseBody, requestErrorResponse } from "@/requests/http"
import { getRequestRuntime } from "@/requests/runtime"
import { getRequestCollection, setRequestCollection } from "@/requests/service"

export const dynamic = "force-dynamic"

/**
 * @summary Whether you can request books here, and where they go
 * @desc `enabled` is false when the server has no acquisition adapter; every
 *       request control should then be hidden. `collections` are the
 *       private collections you belong to, any of which can be your shelf
 *       for requested books.
 */
export const GET = withHasPermission("bookRead")(async (request) => {
  const userId = request.auth.user.id
  if (!getRequestRuntime()) {
    return NextResponse.json({
      enabled: false,
      collection: null,
      collections: [],
    })
  }
  const collections = await db
    .selectFrom("collection")
    .innerJoin(
      "collectionToUser",
      "collectionToUser.collectionUuid",
      "collection.uuid",
    )
    .select(["collection.uuid", "collection.name"])
    .where("collectionToUser.userId", "=", userId)
    .where("collection.public", "=", false)
    .orderBy("collection.name")
    .execute()
  return NextResponse.json({
    enabled: true,
    collection: await getRequestCollection(userId),
    collections,
  })
})

/** @summary Choose the shelf your requested books go on */
export const PUT = withHasPermission("bookRead")(async (request) => {
  const body = await parseBody(request, z.object({ collection: UuidSchema }))
  if (!body.ok) return body.response
  try {
    await setRequestCollection(request.auth.user.id, body.data.collection)
    return new Response(null, { status: 204 })
  } catch (error) {
    return requestErrorResponse(error)
  }
})
