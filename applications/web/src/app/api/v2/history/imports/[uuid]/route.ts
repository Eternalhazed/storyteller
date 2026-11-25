import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { getImportJob } from "@/database/readingHistory"
import {
  HistoryUuidSchema,
  historyError,
  toImportJobView,
} from "@/history/http"

export const dynamic = "force-dynamic"

export const GET = withHasPermission<Promise<{ uuid: string }>>("bookRead")(
  async (request, context) => {
    const uuid = HistoryUuidSchema.safeParse((await context.params).uuid)
    const job = uuid.success
      ? await getImportJob(request.auth.user.id, uuid.data)
      : null
    if (!job) return historyError("No such import.", "not-found", 404)
    return NextResponse.json(toImportJobView(job))
  },
)
