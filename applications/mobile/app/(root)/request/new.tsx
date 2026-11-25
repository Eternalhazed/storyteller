import { skipToken } from "@reduxjs/toolkit/query"
import {
  type ChosenWork,
  type Release,
  type RequestFormat,
} from "@storyteller/web/src/requests/types"
import {
  type RankedRelease,
  type ReleaseFlag,
} from "@storyteller/web/src/requests/ranking"
import { type LibraryCopy } from "@storyteller/web/src/requests/library"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Pressable, View } from "react-native"

import {
  OtherRequestAccount,
  RequestError,
  RequestPage,
} from "@/components/RequestPage"
import { OpenRequestedBook } from "@/components/RequestSummary"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useRequestConfig, useRequestServer } from "@/hooks/useBookRequests"
import { cn } from "@/lib/utils"
import { useAppDispatch } from "@/store/appState"
import {
  canPickRequestRelease,
  REQUEST_FORMAT_LABEL,
} from "@/store/requestCard"
import {
  requestErrorCode,
  requestErrorMessage,
  requestErrorStatus,
} from "@/store/requestErrors"
import {
  parsePickerTarget,
  type RequestPickerParams,
  type RequestPickerTarget,
} from "@/store/requestNavigation"
import {
  type RequestConfig,
  type RequestSearchResult,
  serverApi,
} from "@/store/serverApi"
import { type UUID } from "@/uuid"

const FORMATS = ["ebook", "audio"] as const
const FLAG_LABEL: Record<ReleaseFlag, string> = {
  abridged: "Abridged",
  dramatized: "Dramatized",
  pack: "Multi-book pack",
  "few-seeders": "Few seeders",
  "narrator-unverified": "Narrator not verified",
  "title-differs": "Different title",
}

type Picks = Record<RequestFormat, RankedRelease | null>
const NO_PICKS: Picks = { ebook: null, audio: null }

function fileTypes(release: Release) {
  return (
    release.facts.fileTypes?.value.join(", ").toUpperCase() ||
    "File type unknown"
  )
}

function narrators(release: Release) {
  return release.facts.narrators?.value.join(", ") || "Narrator unknown"
}

function lengthLabel(seconds: number | undefined) {
  if (seconds === undefined) return "Length unknown"
  if (seconds > 0 && seconds < 60) return "<1 m"
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} h ${minutes % 60} m` : `${minutes} m`
}

function sizeLabel(bytes: number | null) {
  if (bytes === null) return "Size unknown"
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

function usableCopy(copies: LibraryCopy[] | undefined) {
  return (
    copies?.find((copy) => copy.ebook && copy.audiobook) ??
    copies?.find((copy) => copy.ebook || copy.audiobook)
  )
}

function releaseSummary(format: RequestFormat, release: RankedRelease | null) {
  if (!release) return "None"
  if (format === "ebook") return fileTypes(release)
  const abridged = release.facts.abridged?.value
  return [
    narrators(release),
    abridged === undefined
      ? "Abridgment unknown"
      : abridged
        ? "abridged"
        : "unabridged",
    lengthLabel(release.facts.durationSeconds?.value),
  ].join(", ")
}

function releaseKey({
  source,
  id,
  kind,
}: Pick<Release, "source" | "id" | "kind">) {
  return JSON.stringify([kind, source, id])
}

function sameRelease(left: Release | null, right: Release | null) {
  return (
    left?.source === right?.source &&
    left?.id === right?.id &&
    left?.kind === right?.kind
  )
}

function releaseRef(release: RankedRelease | null) {
  if (!release) return null
  const { source, id, kind } = release
  return { source, id, kind }
}

function ReleaseOptions({
  format,
  releases,
  selected,
  choose,
  allowNone,
  disabled,
}: {
  format: RequestFormat
  releases: RankedRelease[]
  selected: RankedRelease | null
  choose: (release: RankedRelease | null) => void
  allowNone: boolean
  disabled: boolean
}) {
  return (
    <View
      className="gap-2"
      accessibilityRole="radiogroup"
      accessibilityLabel={`${REQUEST_FORMAT_LABEL[format]} versions`}
    >
      {allowNone && (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: selected === null, disabled }}
          disabled={disabled}
          className={cn(
            "border-border rounded-md border p-3",
            selected === null && "border-primary bg-primary/5",
          )}
          onPress={() => choose(null)}
        >
          <Text>None</Text>
        </Pressable>
      )}
      {releases.map((release) => {
        const checked = sameRelease(selected, release)
        const unavailable = disabled || release.excluded !== null
        return (
          <Pressable
            key={releaseKey(release)}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled: unavailable }}
            disabled={unavailable}
            onPress={() => choose(release)}
            className={cn(
              "border-border gap-1 rounded-md border p-3",
              checked && "border-primary bg-primary/5",
              release.excluded && "bg-muted",
            )}
          >
            <Text className="font-semibold">{release.title}</Text>
            <Text className="text-muted-foreground text-sm">
              {[
                narrators(release),
                fileTypes(release),
                lengthLabel(release.facts.durationSeconds?.value),
                sizeLabel(release.size),
                `${release.seeders} ${release.seeders === 1 ? "seeder" : "seeders"}`,
                release.source,
              ].join(" · ")}
            </Text>
            {release.flags.length > 0 && (
              <View className="flex-row flex-wrap gap-1">
                {release.flags.map((flag) => (
                  <Text
                    key={flag}
                    className="bg-secondary rounded-full px-2 py-1 text-xs"
                  >
                    {FLAG_LABEL[flag]}
                  </Text>
                ))}
              </View>
            )}
            {release.excluded && (
              <Text className="text-muted-foreground text-sm">
                Unavailable: {release.excluded}
              </Text>
            )}
          </Pressable>
        )
      })}
      {!releases.length && (
        <Text className="text-muted-foreground">No versions found.</Text>
      )}
    </View>
  )
}

function Picker({
  serverUuid,
  target,
  work,
  config,
  refreshConfig,
  previousRelease,
}: {
  serverUuid: UUID
  target: RequestPickerTarget
  work: ChosenWork
  config: RequestConfig
  refreshConfig: () => void
  previousRelease?: Pick<Release, "source" | "id" | "kind"> | null
}) {
  const router = useRouter()
  const dispatch = useAppDispatch()
  const replacement = "requestUuid" in target
  const resolved = !replacement && target.resolved === true
  const needsTitle =
    !replacement && (target.kind === "gap" || target.kind === "successor")
  const [title, setTitle] = useState(work.title)
  const [searched, setSearched] = useState<{
    work: ChosenWork
    result: RequestSearchResult
  } | null>(null)
  const [picks, setPicks] = useState<Picks>(NO_PICKS)
  const [expanded, setExpanded] = useState<RequestFormat | null>(null)
  const [blocked, setBlocked] = useState<string[]>(() =>
    previousRelease ? [releaseKey(previousRelease)] : [],
  )
  const [chooseShelf, setChooseShelf] = useState(false)
  const [addedCopy, setAddedCopy] = useState<LibraryCopy | null>(null)
  const [savedForLater, setSavedForLater] = useState(false)
  const autoSearched = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [search, { isLoading: searching }] =
    serverApi.useSearchRequestReleasesMutation()
  const [setCollection, { isLoading: savingShelf }] =
    serverApi.useSetRequestCollectionMutation()
  const [create, { isLoading: creating }] = serverApi.useCreateRequestMutation()
  const [replace, { isLoading: replacing }] =
    serverApi.useReplaceRequestReleaseMutation()
  const [addToShelf, { isLoading: adding }] =
    serverApi.useAddRequestCopyToShelfMutation()
  const busy = searching || savingShelf || creating || replacing || adding
  const mustChooseShelf = !replacement && (chooseShelf || !config.collection)
  const canSearch =
    !!title.trim() && (!needsTitle || title.trim() !== work.title.trim())
  const seriesUuid = replacement ? null : target.input.seriesUuid

  async function searchFor(chosenWork: ChosenWork, lost?: RankedRelease) {
    const hidden = lost ? [...blocked, releaseKey(lost)] : blocked
    if (lost) {
      setBlocked(hidden)
      setPicks((previous) => ({ ...previous, [lost.kind]: null }))
      setExpanded(lost.kind)
    } else {
      setError(null)
      setSavedForLater(false)
      setExpanded(null)
    }
    try {
      const result = await search({
        serverUuid,
        work: chosenWork,
        ...(seriesUuid ? { seriesUuid } : {}),
      }).unwrap()
      setSearched({ work: chosenWork, result })
      const nextPick = (format: RequestFormat) => {
        if ((lockedFormat && lockedFormat !== format) || lost?.kind === format)
          return null
        const previous = picks[format]
        if (lost) {
          const releases = format === "ebook" ? result.ebooks : result.audios
          return previous
            ? (releases.find(
                (release) =>
                  sameRelease(release, previous) &&
                  !release.excluded &&
                  !hidden.includes(releaseKey(release)),
              ) ?? null)
            : null
        }
        const suggested = result.recommendation[format]
        return suggested &&
          !suggested.excluded &&
          !hidden.includes(releaseKey(suggested))
          ? suggested
          : null
      }
      const next = { ebook: nextPick("ebook"), audio: nextPick("audio") }
      setPicks(next)
      if (!lost && "format" in target && !next[target.format])
        setExpanded(target.format)
    } catch (cause) {
      const message = requestErrorMessage(
        cause,
        "Could not search for releases. Try again.",
      )
      setError(
        lost ? `That version is no longer available. ${message}` : message,
      )
    }
  }

  async function saveShelf(collection: UUID) {
    setError(null)
    try {
      await setCollection({ serverUuid, collection }).unwrap()
      setChooseShelf(false)
    } catch (cause) {
      setError(
        requestErrorMessage(cause, "Could not save your shelf. Try again."),
      )
      if (requestErrorCode(cause) === "invalid-collection") refreshConfig()
    }
  }

  function showActionError(cause: unknown, fallback: string) {
    setError(requestErrorMessage(cause, fallback))
    if (requestErrorCode(cause) === "no-collection") {
      setChooseShelf(true)
      refreshConfig()
    }
  }

  async function submit() {
    if (!searched) return
    setError(null)
    try {
      if (replacement) {
        const release = releaseRef(picks[target.format])
        if (!release) return
        await replace({
          serverUuid,
          requestUuid: target.requestUuid,
          format: target.format,
          release,
        }).unwrap()
        if (router.canGoBack()) router.back()
        else router.replace("/")
        return
      }
      await create({
        serverUuid,
        work: searched.work,
        kind: addFormatBookUuid ? "add_format" : target.kind,
        input: target.input,
        ebook: releaseRef(ebook),
        audio: releaseRef(audio),
        ...(addFormatBookUuid ? { bookUuid: addFormatBookUuid } : {}),
      }).unwrap()
      if (!resolved) router.dismissTo("/")
      else if (router.canGoBack()) router.back()
      else router.replace("/")
    } catch (cause) {
      showActionError(cause, "Could not start the request. Try again.")
      const code = requestErrorCode(cause)
      const lost =
        code === "no-seeders-ebook"
          ? picks.ebook
          : code === "no-seeders-audio"
            ? picks.audio
            : null
      if (lost) await searchFor(searched.work, lost)
    }
  }

  async function addCopy(copy: LibraryCopy) {
    if (!searched) return
    const { bookUuid } = copy
    setError(null)
    try {
      await addToShelf({ serverUuid, bookUuid, work: searched.work }).unwrap()
      setAddedCopy(copy)
      dispatch(
        serverApi.endpoints.listBooks.initiate(
          { serverUuid },
          { forceRefetch: true, subscribe: false },
        ),
      )
    } catch (cause) {
      showActionError(
        cause,
        "Could not add this book to your shelf. Try again.",
      )
    }
  }

  const library = searched?.result.library
  const mine =
    !replacement &&
    library?.mine.find(
      (copy) =>
        copy.ebook &&
        copy.audiobook &&
        (target.kind !== "add_format" || target.bookUuid === copy.bookUuid),
    )
  const shelfBookUuid = addedCopy ?? (mine ? mine.bookUuid : null)
  const elsewhere =
    !replacement &&
    target.kind !== "add_format" &&
    library?.elsewhere.find((copy) => copy.ebook && copy.audiobook)
  const recommendation = searched?.result.recommendation
  const recommended =
    recommendation &&
    formats.every((format) =>
      sameRelease(picks[format], recommendation[format]),
    )
  // The API gives one reason line for the pair, not separate format reasons.
  const reasons =
    recommended &&
    (!lockedFormat ||
      !recommendation[lockedFormat === "ebook" ? "audio" : "ebook"])
      ? recommendation.reasons
      : []
  const selected = !!(ebook || audio)
  const submitLabel = replacement
    ? "Use this version"
    : ebook && audio
      ? "Get this pair"
      : audio || lockedFormat === "audio"
        ? "Get audiobook"
        : "Get ebook"

  return (
    <RequestPage>
      {replacement && (
        <Stack.Screen options={{ title: "Pick another version" }} />
      )}
      <View className="gap-2">
        {needsTitle ? (
          <>
            <Text variant="h3">Confirm the book title</Text>
            <Input
              accessibilityLabel="Book title"
              placeholder="Book title"
              value={title}
              editable={!busy}
              onChangeText={(value) => {
                setTitle(value)
                setSearched(null)
                setPicks(NO_PICKS)
                setExpanded(null)
                setBlocked([])
                setAddedCopy(null)
                setError(null)
              }}
            />
            <Text className="text-muted-foreground text-sm">
              Enter the title of the book you want.
            </Text>
          </>
        ) : (
          <Text variant="h3">{work.title}</Text>
        )}
        {!!work.authors.length && (
          <Text className="text-muted-foreground">
            {work.authors.join(", ")}
          </Text>
        )}
        {work.series && (
          <Text className="text-muted-foreground">
            {work.series.name}
            {work.series.position === null ? "" : ` · #${work.series.position}`}
          </Text>
        )}
      </View>
      {mustChooseShelf ? (
        <View className="border-border bg-card gap-3 rounded-lg border p-4">
          <Text className="font-semibold">
            Choose a shelf for requested books
          </Text>
          {config.collections.map(({ uuid, name }) => (
            <Button
              key={uuid}
              variant="outline"
              size="flex"
              disabled={busy}
              onPress={() => saveShelf(uuid)}
            >
              <Text>{name}</Text>
            </Button>
          ))}
          {!config.collections.length && (
            <Text className="text-muted-foreground">
              There are no private shelves available on this account.
            </Text>
          )}
          {savingShelf && (
            <Text className="text-muted-foreground">Saving shelf…</Text>
          )}
        </View>
      ) : shelfBookUuid ? (
        <View className="gap-3">
          <Text>
            {addedCopy
              ? "Added to your shelf."
              : "Already on your shelf in both formats."}
          </Text>
          <OpenRequestedBook serverUuid={serverUuid} bookUuid={shelfBookUuid} />
        </View>
      ) : elsewhere ? (
        <View className="items-start gap-3">
          <Text>
            {elsewhere.ebook && elsewhere.audiobook
              ? "Both formats are already in the household library."
              : `The ${elsewhere.ebook ? "ebook" : "audiobook"} is in the household library. Add it to your shelf to request the missing format.`}
          </Text>
          <Button disabled={busy} onPress={() => addCopy(elsewhere)}>
            <Text>{adding ? "Adding…" : "Add to my shelf"}</Text>
          </Button>
        </View>
      ) : (
        <>
          <Button
            variant={searched ? "outline" : "default"}
            disabled={!canSearch || busy}
            className="self-start"
            onPress={() => searchFor({ ...work, title: title.trim() })}
          >
            <Text>
              {searching
                ? "Searching…"
                : searched
                  ? "Search again"
                  : "Search releases"}
            </Text>
          </Button>
          {searched && (
            <View className="gap-3">
              <View className="border-border bg-card gap-1 rounded-lg border p-4">
                <Text className="font-semibold">
                  {recommended && selected ? "Recommended" : "Your picks"}
                </Text>
                <Text>
                  {formats
                    .map(
                      (format) =>
                        `${REQUEST_FORMAT_LABEL[format]}: ${releaseSummary(format, picks[format])}`,
                    )
                    .join(" · ")}
                </Text>
                {reasons.length > 0 && (
                  <Text className="text-muted-foreground text-sm">
                    {reasons.join(" · ")}
                  </Text>
                )}
                {!selected && !notFound && (
                  <Text className="text-muted-foreground text-sm">
                    Choose a version to continue.
                  </Text>
                )}
              </View>
              <View className="flex-row flex-wrap gap-2">
                {formats.map((format) => (
                  <Button
                    key={format}
                    variant="outline"
                    disabled={busy}
                    accessibilityState={{
                      expanded: expanded === format,
                      disabled: busy,
                    }}
                    onPress={() =>
                      setExpanded(expanded === format ? null : format)
                    }
                  >
                    <Text>
                      {expanded === format ? "Hide" : "Change"}{" "}
                      {REQUEST_FORMAT_LABEL[format].toLowerCase()}
                    </Text>
                  </Button>
                ))}
              </View>
              {expanded && formats.includes(expanded) && (
                <ReleaseOptions
                  format={expanded}
                  releases={(expanded === "ebook"
                    ? searched.result.ebooks
                    : searched.result.audios
                  ).filter((release) => !blocked.includes(releaseKey(release)))}
                  selected={picks[expanded]}
                  allowNone={!replacement}
                  disabled={busy}
                  choose={(release) => {
                    setPicks({ ...picks, [expanded]: release })
                    setExpanded(null)
                    setError(null)
                  }}
                />
              )}
              <Button
                className="self-start"
                disabled={!selected || busy}
                onPress={submit}
              >
                <Text>{creating || replacing ? "Starting…" : submitLabel}</Text>
              </Button>
            </View>
          )}
        </>
      )}
      {error && <RequestError>{error}</RequestError>}
    </RequestPage>
  )
}

export default function NewRequestScreen() {
  const params = useLocalSearchParams<RequestPickerParams>()
  const { serverUuid, isLoading } = useRequestServer(params["serverUuid"])
  const { config, isFetching, refetch } = useRequestConfig(serverUuid)
  const target = parsePickerTarget(params)
  const replacement = target && "requestUuid" in target ? target : null
  const detail = serverApi.useGetRequestQuery(
    serverUuid && config?.enabled && replacement
      ? { serverUuid, requestUuid: replacement.requestUuid }
      : skipToken,
    { refetchOnMountOrArgChange: true },
  )

  if (requestErrorStatus(detail.error) === 403) return <OtherRequestAccount />
  if (
    isLoading ||
    (!config && isFetching) ||
    (replacement && detail.isFetching && !detail.currentData)
  ) {
    return (
      <RequestPage>
        <Text>Loading…</Text>
      </RequestPage>
    )
  }
  if (!serverUuid || !config?.enabled) {
    return (
      <RequestPage>
        <Text>Book requests aren’t available on this server.</Text>
      </RequestPage>
    )
  }
  if (!target)
    return (
      <RequestPage>
        <Text>No book was selected.</Text>
      </RequestPage>
    )
  if ("requestUuid" in target) {
    const request = detail.isError ? undefined : detail.currentData
    if (!request)
      return (
        <RequestPage>
          <RequestError>Could not load this request.</RequestError>
        </RequestPage>
      )
    if (!canPickRequestRelease(request[target.format].status)) {
      return (
        <RequestPage>
          <Text>This format no longer needs a new version.</Text>
        </RequestPage>
      )
    }
    return (
      <Picker
        key={`${serverUuid}:${target.requestUuid}:${target.format}`}
        serverUuid={serverUuid}
        target={target}
        work={request.work}
        config={config}
        refreshConfig={refetch}
        previousRelease={request[target.format].release}
      />
    )
  }
  return (
    <Picker
      key={JSON.stringify([serverUuid, target])}
      serverUuid={serverUuid}
      target={target}
      work={target.work}
      config={config}
      refreshConfig={refetch}
    />
  )
}
