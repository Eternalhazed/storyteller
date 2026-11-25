import { getTranslations } from "next-intl/server"

import { withPageAuth } from "@v3/_/server/page-auth-wrapper"

import { getUnmarkedImportedLibraryReads } from "@/database/readingHistory"
import { getHistorySummaries } from "@/history/http"

import { ReadingHistoryForm } from "./reading-history-form"

export async function generateMetadata() {
  const t = await getTranslations("ReadingHistoryPage")
  return { title: t("title").replace(/^__fallback__/, "") }
}

export default withPageAuth<{ params: Promise<Record<string, unknown>> }>([
  "bookRead",
])(async (_props, user) => {
  const [sources, books] = await Promise.all([
    getHistorySummaries(user.id),
    getUnmarkedImportedLibraryReads(user.id),
  ])
  return <ReadingHistoryForm initialSources={sources} initialBooks={books} />
})
