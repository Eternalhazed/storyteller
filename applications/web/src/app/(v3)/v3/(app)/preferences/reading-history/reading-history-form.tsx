"use client"

import { useFormatter } from "next-intl"
import { type SubmitEvent, useEffect, useState } from "react"
import { toast } from "sonner"

import { SiteHeader } from "@v3/_/components/site-header"
import { Button } from "@v3/_/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@v3/_/components/ui/card"
import { ConfirmDialog } from "@v3/_/components/ui/confirm-dialog"
import { Input } from "@v3/_/components/ui/input"
import {
  PageContent,
  PageHeader,
  PageLayout,
  PageMain,
} from "@v3/_/components/ui/page-layout"
import { useTranslation } from "@v3/_/hooks/use-translation"

import {
  type HistoryItemSource,
  type HistoryLibraryRead,
  type HistorySource,
  type HistorySourceSummary,
  type ImportJobView,
  type UnmatchedItemView,
} from "@/history/types"

const MIME_TYPES: Record<HistorySource, string> = {
  goodreads: ".csv,text/csv",
  audible: ".json,application/json",
  kindle: ".zip,application/zip",
}

async function historyRequest(path = "", options?: RequestInit) {
  const response = await fetch(`/api/v2/history${path}`, {
    ...options,
    cache: "no-store",
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new Error(
      body &&
        typeof body === "object" &&
        "message" in body &&
        typeof body.message === "string"
        ? body.message
        : undefined,
    )
  }
  return response
}

async function historyJson<T>(
  path?: string,
  options?: RequestInit,
): Promise<T> {
  return (await (await historyRequest(path, options)).json()) as T
}

export function ReadingHistoryForm({
  initialSources,
  initialBooks,
}: {
  initialSources: HistorySourceSummary[]
  initialBooks: HistoryLibraryRead[]
}) {
  const t = useTranslation("ReadingHistoryPage")
  const account = useTranslation("AppSidebar")
  const format = useFormatter()
  const [sources, setSources] = useState(initialSources)
  const [books, setBooks] = useState(initialBooks)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<HistoryItemSource | null>(
    null,
  )
  const [review, setReview] = useState<
    { loading: true } | { items: UnmatchedItemView[] } | { error: true } | null
  >(null)
  const [reviewVersion, setReviewVersion] = useState(0)
  const [pollFailed, setPollFailed] = useState(false)
  const isRunning = sources.some(
    ({ lastImport }) => lastImport?.status === "running",
  )
  const unmatchedCount = sources.reduce(
    (sum, source) => sum + source.unmatched,
    0,
  )
  const reviewOpen = review !== null

  useEffect(() => {
    if (!reviewOpen || busy) return
    const controller = new AbortController()
    void historyJson<{ items: UnmatchedItemView[] }>("/unmatched", {
      signal: controller.signal,
    }).then(
      ({ items }) => {
        if (!controller.signal.aborted) setReview({ items })
      },
      () => {
        if (!controller.signal.aborted) setReview({ error: true })
      },
    )
    return () => {
      controller.abort()
    }
  }, [reviewOpen, reviewVersion, busy])

  useEffect(() => {
    if (!isRunning || busy) return
    const controller = new AbortController()
    const { signal } = controller
    let timer: number | undefined
    const poll = async () => {
      try {
        const result = await historyJson<{ sources: HistorySourceSummary[] }>(
          "",
          { signal },
        )
        if (signal.aborted) return
        if (
          !result.sources.some(
            ({ lastImport }) => lastImport?.status === "running",
          )
        ) {
          const reads = await historyJson<{ books: HistoryLibraryRead[] }>(
            "/library-reads",
            { signal },
          )
          signal.throwIfAborted()
          setBooks(reads.books)
          setReviewVersion((version) => version + 1)
          setSources(result.sources)
          setPollFailed(false)
          return
        }
        setSources(result.sources)
        setPollFailed(false)
      } catch {
        if (!signal.aborted) setPollFailed(true)
      }
      if (!signal.aborted)
        timer = window.setTimeout(() => {
          void poll()
        }, 2000)
    }
    timer = window.setTimeout(() => {
      void poll()
    }, 1200)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [isRunning, busy])

  async function refreshViews() {
    const [summary, reads] = await Promise.all([
      historyJson<{ sources: HistorySourceSummary[] }>(),
      historyJson<{ books: HistoryLibraryRead[] }>("/library-reads"),
    ])
    setSources(summary.sources)
    setBooks(reads.books)
  }

  async function action(key: string, write: () => Promise<void>) {
    setBusy(key)
    try {
      await write()
      await refreshViews()
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t.plain("requestFailed"),
      )
    } finally {
      setBusy(null)
    }
  }

  function upload(event: SubmitEvent<HTMLFormElement>, source: HistorySource) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    data.set("source", source)
    void action(source, async () => {
      const job = await historyJson<ImportJobView>("/imports", {
        method: "POST",
        body: data,
      })
      setSources((current) =>
        current.map((entry) =>
          entry.source === source
            ? {
                source,
                items: job.total,
                matched: 0,
                unmatched: 0,
                lastImport: job,
              }
            : entry,
        ),
      )
      form.reset()
    })
  }

  function match(
    item: UnmatchedItemView,
    body: { key: string } | { ignore: true },
  ) {
    void action(item.uuid, async () => {
      await historyRequest(`/items/${item.uuid}/match`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      setReview((current) =>
        current && "items" in current
          ? { items: current.items.filter(({ uuid }) => uuid !== item.uuid) }
          : current,
      )
      setSources((current) =>
        current.map((entry) =>
          entry.source === item.source
            ? {
                ...entry,
                unmatched: Math.max(0, entry.unmatched - 1),
                matched: entry.matched + ("key" in body ? 1 : 0),
              }
            : entry,
        ),
      )
    })
  }

  return (
    <PageLayout>
      <PageMain>
        <PageHeader>
          <SiteHeader
            breadcrumbs={[
              { label: account.plain("account"), url: "/preferences" },
              { label: t.plain("title") },
            ]}
          />
        </PageHeader>
        <PageContent>
          <div className="mx-auto max-w-3xl space-y-5 px-4 pt-4 pb-12 md:px-8">
            <div className="text-muted-foreground space-y-2 text-sm">
              <p>{t("intro")}</p>
              <p>{t("matchingNotice")}</p>
            </div>
            {pollFailed && (
              <p role="status" className="text-destructive text-sm">
                {t("requestFailed")}
              </p>
            )}
            {sources.map(
              ({ source, items, matched, unmatched, lastImport }) => {
                if (source === "manual" && !items) return null
                const name = t.plain(source)
                const running = lastImport?.status === "running"
                return (
                  <Card key={source}>
                    <CardHeader>
                      <CardTitle>{t(source)}</CardTitle>
                      <CardDescription>
                        {source === "manual"
                          ? t("manualDescription")
                          : t(`${source}Export`)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {source === "audible" && (
                        <code className="bg-muted block rounded-md px-3 py-2 text-sm">
                          audible-cli library export -f json
                        </code>
                      )}
                      {source !== "manual" && (
                        <form
                          className="flex flex-wrap gap-2"
                          onSubmit={(event) => {
                            upload(event, source)
                          }}
                        >
                          <Input
                            type="file"
                            name="file"
                            accept={MIME_TYPES[source]}
                            aria-label={t.plain("fileLabel", { source: name })}
                            disabled={running || busy !== null}
                            required
                            className="max-w-80 min-w-0 flex-1"
                          />
                          <Button
                            type="submit"
                            disabled={running || busy !== null}
                          >
                            {t("upload")}
                          </Button>
                        </form>
                      )}
                      {lastImport && running && (
                        <div className="space-y-1" role="status">
                          <p
                            className="text-muted-foreground text-sm"
                            id={`${source}-progress`}
                          >
                            {t("importRunning", {
                              processed: format.number(lastImport.processed),
                              total: format.number(lastImport.total),
                            })}
                          </p>
                          <progress
                            className="accent-primary block w-full"
                            aria-labelledby={`${source}-progress`}
                            value={lastImport.processed}
                            max={lastImport.total || 1}
                          />
                        </div>
                      )}
                      {lastImport?.status === "failed" && (
                        <p role="alert" className="text-destructive text-sm">
                          {lastImport.error ?? t("importFailed")}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-muted-foreground text-sm">
                          <p>
                            {t("sourceCount", {
                              items,
                              matched: format.number(matched),
                              unmatched: format.number(unmatched),
                            })}
                          </p>
                          {lastImport && (
                            <p>
                              {t("lastImport", {
                                date: format.dateTime(
                                  new Date(lastImport.createdAt),
                                  { dateStyle: "medium" },
                                ),
                              })}
                            </p>
                          )}
                        </div>
                        {(items > 0 || lastImport) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            aria-label={t.plain("deleteTitle", {
                              source: name,
                            })}
                            onClick={() => {
                              setConfirmDelete(source)
                            }}
                          >
                            {t("delete")}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              },
            )}

            {books.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t("markTitle", { count: books.length })}
                  </CardTitle>
                  <CardDescription>{t("markDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <details>
                    <summary className="cursor-pointer text-sm underline">
                      {t("markList")}
                    </summary>
                    <ul className="my-2 max-h-64 list-disc overflow-y-auto ps-6 text-sm">
                      {books.map(({ bookUuid, title }) => (
                        <li key={bookUuid}>{title}</li>
                      ))}
                    </ul>
                  </details>
                  <Button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      void action("read", async () => {
                        await historyRequest("/library-reads", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            bookUuids: books.map(({ bookUuid }) => bookUuid),
                          }),
                        })
                        toast.success(t("marked"))
                      })
                    }}
                  >
                    {t("markRead")}
                  </Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>{t("reviewTitle")}</CardTitle>
                <CardDescription>{t("reviewDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {unmatchedCount === 0 && !reviewOpen ? (
                  <p className="text-muted-foreground text-sm">
                    {t("reviewEmpty")}
                  </p>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    aria-expanded={reviewOpen}
                    aria-controls="unmatched-review"
                    onClick={() => {
                      setReview(reviewOpen ? null : { loading: true })
                    }}
                  >
                    {reviewOpen
                      ? t("reviewHide")
                      : t("reviewShow", { count: unmatchedCount })}
                  </Button>
                )}
                <div id="unmatched-review" hidden={!reviewOpen}>
                  {review && "loading" in review && (
                    <p role="status" className="text-muted-foreground text-sm">
                      {t("reviewLoading")}
                    </p>
                  )}
                  {review && "error" in review && (
                    <div className="space-y-2">
                      <p role="alert" className="text-destructive text-sm">
                        {t("requestFailed")}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setReview({ loading: true })
                          setReviewVersion((version) => version + 1)
                        }}
                      >
                        {t("retry")}
                      </Button>
                    </div>
                  )}
                  {review &&
                    "items" in review &&
                    (review.items.length ? (
                      <ul className="divide-border divide-y rounded-md border">
                        {review.items.map((item) => (
                          <li key={item.uuid} className="space-y-2 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-medium wrap-break-word">
                                  {item.title}
                                </p>
                                <p className="text-muted-foreground text-sm">
                                  {[...item.authors, t.plain(item.source)].join(
                                    " · ",
                                  )}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => {
                                  match(item, { ignore: true })
                                }}
                              >
                                {t("ignore")}
                              </Button>
                            </div>
                            {item.candidates.length === 0 ? (
                              <p className="text-muted-foreground text-sm">
                                {t("noCandidates")}
                              </p>
                            ) : (
                              <ul className="space-y-1">
                                {item.candidates.map(
                                  ({ key, title, authors, releaseDate }) => (
                                    <li
                                      key={key}
                                      className="bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm"
                                    >
                                      <span className="min-w-0 wrap-break-word">
                                        {[
                                          title,
                                          ...authors,
                                          releaseDate?.slice(0, 4),
                                        ]
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </span>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={busy !== null}
                                        onClick={() => {
                                          match(item, { key })
                                        }}
                                      >
                                        {t("choose")}
                                      </Button>
                                    </li>
                                  ),
                                )}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        {t("reviewEmpty")}
                      </p>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </PageContent>
      </PageMain>
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
        title={
          confirmDelete
            ? t.plain("deleteTitle", { source: t.plain(confirmDelete) })
            : ""
        }
        description={t.plain("deleteDescription")}
        confirmLabel={t.plain("delete")}
        variant="destructive"
        isLoading={busy !== null}
        onConfirm={async () => {
          if (!confirmDelete) return
          await action(confirmDelete, async () => {
            await historyRequest(`?source=${confirmDelete}`, {
              method: "DELETE",
            })
            setReview((current) =>
              current && "items" in current
                ? {
                    items: current.items.filter(
                      ({ source }) => source !== confirmDelete,
                    ),
                  }
                : current,
            )
          })
        }}
      />
    </PageLayout>
  )
}
