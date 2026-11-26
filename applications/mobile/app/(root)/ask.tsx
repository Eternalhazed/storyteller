import {
  type HelperMessage,
  type HelperTurn,
} from "@storyteller/web/src/recommendations/helper"
import {
  type AskCard,
  type AskResult,
  type RoundView,
} from "@storyteller/web/src/recommendations/types"
import { Link, useLocalSearchParams } from "expo-router"
import { Mic, Square } from "lucide-react-native"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import {
  Platform,
  ScrollView,
  type ScrollViewInstance,
  View,
} from "react-native"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"

import {
  PickCard,
  RecommendationCover,
  RoundProgress,
} from "@/components/RecommendationCards"
import { RequestError, RequestPage } from "@/components/RequestPage"
import { OpenRequestedBook } from "@/components/RequestSummary"
import { ScreenBackButton } from "@/components/ScreenBackButton"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useRequestServer } from "@/hooks/useBookRequests"
import { useHelperDictation } from "@/hooks/useHelperDictation"
import { useIsFocused } from "@/hooks/useIsFocused"
import {
  useRecommendationConfig,
  useRecommendationRound,
} from "@/hooks/useRecommendations"
import { usesSystemHeader } from "@/lib/nativeChrome"
import { useAppDispatch } from "@/store/appState"
import { useListStatusesQuery, useUpdateStatusMutation } from "@/store/localApi"
import { resolvedWorkHref, seriesLine } from "@/store/recommendations"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

function AskBookCard({
  card,
  serverUuid,
  requestsEnabled,
  offline,
}: {
  card: AskCard
  serverUuid: UUID
  requestsEnabled: boolean
  offline: boolean
}) {
  const { work, series, bookUuid, state } = card
  return (
    <View className="border-border bg-card flex-row items-start gap-3 rounded-lg border p-3">
      <RecommendationCover url={work.coverUrl} />
      <View className="min-w-0 flex-1 gap-1.5">
        <Text className="font-semibold">{work.title}</Text>
        {!!work.authors.length && <Text>{work.authors.join(", ")}</Text>}
        {(series || work.series) && (
          <Text className="text-muted-foreground text-sm">
            {series
              ? seriesLine(series)
              : `${work.series?.name}${work.series?.position == null ? "" : ` · #${work.series.position}`}`}
          </Text>
        )}
        {bookUuid && (state === "on_shelf" || state === "to_read") ? (
          <OpenRequestedBook
            serverUuid={serverUuid}
            bookUuid={bookUuid}
            label={
              state === "on_shelf"
                ? "On your shelf: read now"
                : "On your To read"
            }
          />
        ) : (state === "household" || state === "get") && requestsEnabled ? (
          <Link href={resolvedWorkHref(serverUuid, work)} asChild>
            <Button className="self-start" size="flex" disabled={offline}>
              <Text className="shrink">
                {state === "household"
                  ? "In the household library: add to my shelf"
                  : "Get"}
              </Text>
            </Button>
          </Link>
        ) : state === "household" ? (
          <Text className="text-muted-foreground">
            In the household library
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function AskRound({
  initial,
  serverUuid,
  requestsEnabled,
  offline,
}: {
  initial: RoundView
  serverUuid: UUID
  requestsEnabled: boolean
  offline: boolean
}) {
  const focused = useIsFocused()
  const query = useRecommendationRound(
    serverUuid,
    initial.uuid,
    initial.status === "running",
    focused,
  )
  const round = query.currentData ?? initial
  const picks = query.currentData?.picks ?? []
  return (
    <View className="gap-2">
      <RoundProgress round={round} />
      {query.isError ? (
        <View className="items-start gap-2">
          <RequestError>Could not load this round.</RequestError>
          <Button variant="outline" onPress={() => query.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : round.status === "done" && query.currentData && !picks.length ? (
        <Text className="text-muted-foreground">
          No picks this time. Try asking for something different.
        </Text>
      ) : (
        picks.map((pick) => (
          <PickCard
            key={pick.uuid}
            pick={pick}
            serverUuid={serverUuid}
            requestsEnabled={requestsEnabled}
            offline={offline}
          />
        ))
      )}
    </View>
  )
}

function AskAnchor({
  anchor,
  serverUuid,
  offline,
}: {
  anchor: Extract<AskResult, { intent: "next" }>["anchor"]
  serverUuid: UUID
  offline: boolean
}) {
  const dispatch = useAppDispatch()
  const { currentData: statuses } = useListStatusesQuery()
  const read = statuses?.find((status) => status.name === "Read")
  const [updateStatus] = useUpdateStatusMutation()
  const [marked, setMarked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const { bookUuid, title } = anchor
  if (anchor.read || !bookUuid) return null

  async function markRead() {
    if (!bookUuid || !read) return
    setBusy(true)
    setError(false)
    try {
      await dispatch(
        serverApi.endpoints.getBook.initiate(
          { serverUuid, bookUuid },
          { forceRefetch: true, subscribe: false },
        ),
      ).unwrap()
      await updateStatus({ bookUuid, statusUuid: read.uuid }).unwrap()
      setMarked(true)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View className="items-start gap-2">
      {marked ? (
        <Text>{title} was marked as read.</Text>
      ) : (
        <Button
          variant="outline"
          size="flex"
          disabled={!read || busy || offline}
          onPress={markRead}
        >
          <Text className="shrink">Mark {title} as read</Text>
        </Button>
      )}
      {error && (
        <RequestError>
          Could not mark this book as read. Try again.
        </RequestError>
      )}
    </View>
  )
}

type ResultProps = {
  serverUuid: UUID
  requestsEnabled: boolean
  offline: boolean
}

function HelperResult({
  result,
  ...cardProps
}: ResultProps & { result: AskResult }) {
  const [choices, setChoices] = useState<Record<number, AskCard>>({})
  const { serverUuid, offline } = cardProps
  return (
    <>
      {result?.intent === "get" && (
        <>
          {result.cards.map((card) => (
            <AskBookCard key={card.work.key} card={card} {...cardProps} />
          ))}
          {result.questions.map((question, index) => {
            const chosen = choices[index]
            return chosen ? (
              <AskBookCard key={index} card={chosen} {...cardProps} />
            ) : (
              <View key={index} className="items-start gap-2">
                <Text variant="h4">Which one did you mean?</Text>
                <Text className="text-muted-foreground">{question.asked}</Text>
                {question.choices.slice(0, 4).map((card) => (
                  <Button
                    key={card.work.key}
                    variant="outline"
                    size="flex"
                    onPress={() => setChoices({ ...choices, [index]: card })}
                  >
                    <Text className="shrink">
                      {[
                        card.work.title,
                        card.work.authors.join(", "),
                        card.work.series?.name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </Button>
                ))}
              </View>
            )
          })}
          {result.notFound.map((title, index) => (
            <Text key={index}>Not found: {title}</Text>
          ))}
        </>
      )}
      {result?.intent === "next" && (
        <AskAnchor
          key={result.anchor.bookUuid ?? result.anchor.title}
          anchor={result.anchor}
          serverUuid={serverUuid}
          offline={offline}
        />
      )}
      {(result?.intent === "next" || result?.intent === "wish") &&
        (result.round ? (
          <AskRound
            key={result.round.uuid}
            initial={result.round}
            {...cardProps}
          />
        ) : (
          <Text className="text-muted-foreground">
            No follow-up picks available right now.
          </Text>
        ))}
      {result?.intent === "unclear" && <Text>{result.message}</Text>}
    </>
  )
}

type ConversationEntry =
  | { role: "reader"; text: string }
  | { role: "helper"; text: string; turn: HelperTurn }

function HelperBubble({ text }: { text: string }) {
  return (
    <View className="bg-card border-border max-w-[90%] self-start rounded-xl rounded-tl-sm border px-4 py-3">
      <Text>{text}</Text>
    </View>
  )
}

function ReaderBubble({ text }: { text: string }) {
  return (
    <View className="bg-secondary max-w-[90%] self-end rounded-xl rounded-tr-sm px-4 py-3">
      <Text className="text-secondary-foreground">{text}</Text>
    </View>
  )
}

function HelperConversation({
  initialText,
  autoSubmit,
  speechEnabled,
  ...cardProps
}: ResultProps & {
  initialText: string
  autoSubmit: boolean
  speechEnabled: boolean
}) {
  const { serverUuid, offline } = cardProps
  const [text, setText] = useState(initialText.slice(0, 1000))
  const [entries, setEntries] = useState<ConversationEntry[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [sendFailed, setSendFailed] = useState(false)
  const [send] = serverApi.useSendHelperMessageMutation()
  const opening = serverApi.useGetHelperOpeningQuery({ serverUuid })
  const submittedInitially = useRef(false)
  const sending = useRef(false)
  const scroll = useRef<ScrollViewInstance>(null)
  const scrollToLatest = useRef(false)
  const dictation = useHelperDictation(serverUuid, (transcript) => {
    setText((draft) =>
      [draft.trim(), transcript].filter(Boolean).join(" ").slice(0, 1000),
    )
  })
  const recording = dictation.phase === "recording"
  const dictating = dictation.phase !== "idle"
  const disabled = offline || pending !== null || dictating

  async function submit(message: string) {
    const readerText = message.trim().slice(0, 1000)
    if (!readerText || disabled || sending.current) return
    sending.current = true
    scrollToLatest.current = true
    setSendFailed(false)
    dictation.clearError()
    setPending(readerText)
    const entry = { role: "reader", text: readerText } as const
    const messages: HelperMessage[] = [...entries, entry]
      .slice(-20)
      .map(({ role, text }) => ({ role, text }))
    try {
      const turn = await send({ serverUuid, messages }).unwrap()
      scrollToLatest.current = true
      setEntries((previous) => [
        ...previous,
        entry,
        { role: "helper", text: turn.reply, turn },
      ])
      setText("")
    } catch {
      setSendFailed(true)
      setText((draft) => draft || readerText)
    } finally {
      sending.current = false
      setPending(null)
    }
  }

  const submitOnOpen = useEffectEvent(() => {
    submittedInitially.current = true
    void submit(initialText)
  })
  useEffect(() => {
    if (
      autoSubmit &&
      initialText.trim() &&
      !submittedInitially.current &&
      !disabled
    ) {
      submitOnOpen()
    }
  }, [autoSubmit, disabled, initialText])

  const active = entries.at(-1)
  const chips =
    active?.role === "helper" ? active.turn.chips : opening.currentData?.chips
  const elapsed = `0:${String(dictation.elapsed).padStart(2, "0")}`

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior="padding"
      enabled={Platform.OS === "ios"}
      automaticOffset
    >
      <ScreenBackButton />
      <ScrollView
        ref={scroll}
        className="flex-1"
        contentContainerClassName="px-safe-or-4 items-center py-4"
        contentInsetAdjustmentBehavior={
          usesSystemHeader ? "automatic" : "never"
        }
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (!scrollToLatest.current) return
          scrollToLatest.current = false
          scroll.current?.scrollToEnd({ animated: false })
        }}
      >
        <View className="w-full max-w-2xl gap-3">
          {(entries.length > 0 || pending !== null) && (
            <Button
              className="self-end"
              variant="ghost"
              disabled={pending !== null || dictating}
              onPress={() => {
                scrollToLatest.current = false
                setEntries([])
                setText("")
                setSendFailed(false)
                dictation.clearError()
                scroll.current?.scrollTo({ y: 0, animated: false })
              }}
            >
              <Text>Start over</Text>
            </Button>
          )}
          {opening.currentData ? (
            <HelperBubble text={opening.currentData.reply} />
          ) : opening.isError && entries.length === 0 && !offline ? (
            <View className="items-start gap-2">
              <RequestError>
                Couldn’t load suggestions. You can still write a message.
              </RequestError>
              <Button variant="outline" onPress={() => void opening.refetch()}>
                <Text>Reload suggestions</Text>
              </Button>
            </View>
          ) : opening.isLoading && entries.length === 0 && !pending ? (
            <Text className="text-muted-foreground">Loading suggestions…</Text>
          ) : null}
          {entries.map((entry, index) =>
            entry.role === "reader" ? (
              <ReaderBubble key={index} text={entry.text} />
            ) : (
              <View key={index} className="gap-3">
                <HelperBubble text={entry.text} />
                {entry.turn.result && (
                  <HelperResult result={entry.turn.result} {...cardProps} />
                )}
              </View>
            ),
          )}
          {pending !== null && (
            <>
              <ReaderBubble text={pending} />
              <Text
                className="text-muted-foreground"
                accessibilityLiveRegion="polite"
              >
                Thinking…
              </Text>
            </>
          )}
          {pending === null && !!chips?.length && (
            <View className="flex-row flex-wrap gap-2">
              {chips.map((chip) => (
                <Button
                  key={chip}
                  variant="outline"
                  size="flex"
                  className="max-w-full"
                  accessibilityLabel={chip}
                  disabled={disabled}
                  onPress={() => void submit(chip)}
                >
                  <Text className="shrink" numberOfLines={1}>
                    {chip}
                  </Text>
                </Button>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      <View className="border-border bg-background px-safe-or-4 pb-safe-or-3 items-center border-t pt-3">
        <View className="w-full max-w-2xl gap-2">
          {offline && (
            <Text className="text-muted-foreground">
              Reconnect to use Reading helper.
            </Text>
          )}
          {sendFailed && (
            <RequestError>
              Couldn’t get a reply. Your message is ready to send again.
            </RequestError>
          )}
          {dictation.error && <RequestError>{dictation.error}</RequestError>}
          {recording ? (
            <Text
              className="text-destructive text-sm"
              accessibilityLabel={`Recording, ${dictation.elapsed} seconds elapsed`}
            >
              Recording · {elapsed}
            </Text>
          ) : dictation.phase === "transcribing" ? (
            <Text
              className="text-muted-foreground text-sm"
              accessibilityLiveRegion="polite"
            >
              Transcribing…
            </Text>
          ) : null}
          <View className="flex-row items-end gap-2">
            <Input
              className="max-h-28 w-auto flex-1"
              accessibilityLabel="Message to Reading helper"
              placeholder="Tell me what you’re after…"
              value={text}
              onChangeText={setText}
              maxLength={1000}
              editable={pending === null && !dictating}
              multiline
            />
            {(speechEnabled || dictating) && (
              <Button
                variant={recording ? "destructive" : "outline"}
                size="icon"
                className="h-11 w-11"
                accessibilityLabel={
                  recording ? "Stop recording" : "Record a message"
                }
                disabled={!recording && disabled}
                onPress={() => void dictation.toggle()}
              >
                <Icon
                  as={recording ? Square : Mic}
                  className={recording ? "text-white" : ""}
                  size={18}
                />
              </Button>
            )}
            <Button
              className="h-11"
              disabled={disabled || !text.trim()}
              onPress={() => void submit(text)}
            >
              <Text>Send</Text>
            </Button>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

export default function AskScreen() {
  const {
    serverUuid: requestedServer,
    text,
    submit,
  } = useLocalSearchParams<{
    serverUuid?: string
    text?: string
    submit?: string
  }>()
  const { serverUuid, isLoading } = useRequestServer(requestedServer)
  const focused = useIsFocused()
  const query = useRecommendationConfig(serverUuid, focused)
  if (serverUuid && query.config?.helperEnabled) {
    return (
      <HelperConversation
        key={serverUuid}
        serverUuid={serverUuid}
        initialText={text ?? ""}
        autoSubmit={submit === "true"}
        requestsEnabled={query.config.requestsEnabled}
        speechEnabled={query.config.speechEnabled}
        offline={query.isError}
      />
    )
  }
  return (
    <RequestPage>
      {isLoading || query.isLoading ? (
        <Text>Loading…</Text>
      ) : (
        <Text>Reading helper isn’t available on this account.</Text>
      )}
    </RequestPage>
  )
}
