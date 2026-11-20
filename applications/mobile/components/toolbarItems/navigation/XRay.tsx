import { LegendList } from "@legendapp/list/react-native"
import { skipToken } from "@reduxjs/toolkit/query"
import { useFocusEffect } from "expo-router"
import { ArrowLeft, ArrowUpDown } from "lucide-react-native"
import { useCallback, useMemo, useState } from "react"
import { BackHandler, View } from "react-native"
import { withUniwind } from "uniwind"

import {
  type Xray,
  type XrayEntityView,
  chapterIndexOf,
  viewXray,
} from "@storyteller-platform/xray/view"

import { LoadingView } from "@/components/LoadingView"
import { useReaderFormSheetScrollPaddingBottom } from "@/components/toolbarItems/readerFormSheetLayout"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Text } from "@/components/ui/text"
import { useIsFocused } from "@/hooks/useIsFocused"
import { bookmarkPressed } from "@/store/actions"
import { useAppDispatch, useAppSelector } from "@/store/appState"
import { useGetBookQuery, useGetBookXrayQuery } from "@/store/localApi"
import {
  getCurrentlyPlayingFormat,
  getIsPlaying,
  getReturnToPosition,
} from "@/store/selectors/bookshelfSelectors"
import { canUseXray, getXrayBoundary } from "@/store/xrayBoundary"
import {
  type XrayChapterLink,
  type XrayDetailRow,
  type XrayScope,
  buildXrayJump,
  getScopedXrayEntities,
  getXrayChapterLinks,
  getXrayDetailRows,
  getXrayEntitySummary,
  xrayEntityTypeLabels,
  xrayScopeLabels,
} from "@/store/xrayNavigation"
import { type UUID } from "@/uuid"

import {
  getLastXrayScope,
  setLastXrayScope,
} from "./navigationMenuSessionState"

const EntityList = withUniwind(LegendList<XrayEntityView>)
const DetailList = withUniwind(LegendList<XrayDetailRow>)
const scopes: XrayScope[] = ["now", "chapter", "book"]
const entityTypes: {
  type: XrayEntityView["type"]
  label: string
}[] = [
  { type: "character", label: "People" },
  { type: "place", label: "Places" },
  { type: "group", label: "Groups" },
  { type: "thing", label: "Things" },
]

interface Props {
  bookUuid?: UUID | undefined
  format?: "readaloud" | "ebook" | "audiobook" | undefined
  mode?: "text" | "audio" | undefined
  onClose?: (() => void) | undefined
  initialEntityId?: number | undefined
  selectionBoundary?: number | undefined
}

export function XRay(props: Props) {
  const isFocused = useIsFocused()
  // A blurred tab or closed sheet owns no position subscription or view work.
  return isFocused ? <XrayContent {...props} /> : null
}

function XrayContent({
  bookUuid,
  format: formatProp,
  mode = "text",
  onClose,
  initialEntityId,
  selectionBoundary,
}: Props) {
  const dispatch = useAppDispatch()
  const selectedFormat = useAppSelector(getCurrentlyPlayingFormat)
  const format = formatProp ?? selectedFormat ?? "readaloud"
  const paddingBottom = useReaderFormSheetScrollPaddingBottom()
  const isPlaying = useAppSelector(getIsPlaying)
  const [scope, setScope] = useState(getLastXrayScope)
  const [type, setType] = useState<XrayEntityView["type"] | null>(null)
  const [entityId, setEntityId] = useState<number | null>(
    initialEntityId ?? null,
  )
  const { data: book } = useGetBookQuery(
    bookUuid ? { uuid: bookUuid } : skipToken,
  )
  const { data: xray, isLoading } = useGetBookXrayQuery(
    bookUuid ? { bookUuid } : skipToken,
  )
  const returnPosition = useAppSelector((state) =>
    bookUuid ? getReturnToPosition(state, bookUuid) : null,
  )
  const currentLocator = book?.position?.locator
  const manifest =
    format === "readaloud"
      ? book?.readaloud?.epubManifest
      : format === "ebook"
        ? book?.ebook?.manifest
        : null
  const boundary = useMemo(
    () =>
      Math.max(
        getXrayBoundary({
          xray,
          locator: currentLocator,
          mode,
          isPlaying,
          returnPosition,
        }),
        xray &&
          selectionBoundary !== undefined &&
          chapterIndexOf(xray, selectionBoundary) !== -1
          ? selectionBoundary
          : -1,
      ),
    [xray, currentLocator, mode, isPlaying, returnPosition, selectionBoundary],
  )
  const views = useMemo(
    () => (xray ? viewXray(xray, boundary) : []),
    [xray, boundary],
  )
  const chapterLinks = useMemo(
    () => (xray ? getXrayChapterLinks(xray, manifest) : []),
    [xray, manifest],
  )
  const scoped = useMemo(
    () =>
      xray
        ? getScopedXrayEntities({ xray, views, boundary, scope, type })
        : { scope, entities: [] },
    [xray, views, boundary, scope, type],
  )
  const entity = views.find((view) => view.id === entityId)
  const returnToList = useCallback(() => setEntityId(null), [])

  function jumpToSentence(ordinal: number) {
    if (!xray || !bookUuid || ordinal > boundary) return
    const jump = buildXrayJump({
      xray,
      ordinal,
      chapterLinks,
      format,
      currentLocator,
      returnPosition,
    })
    if (!jump) return
    dispatch(bookmarkPressed({ bookUuid, ...jump, timestamp: Date.now() }))
    onClose?.()
  }

  if (isLoading) return <LoadingView />
  if (!canUseXray({ xray, format, mode }) || !xray) {
    return (
      <View className="flex-1 items-center justify-center px-8 py-12">
        <Text className="text-muted-foreground text-center">
          X-Ray is not available for this book.
        </Text>
      </View>
    )
  }

  if (entity) {
    return (
      <XrayDetails
        key={entity.id}
        xray={xray}
        entity={entity}
        chapterLinks={chapterLinks}
        format={format}
        onBack={returnToList}
        onJump={jumpToSentence}
      />
    )
  }

  return (
    <View className="flex-1">
      <View className="border-border gap-2 border-b px-2 py-2">
        <View className="flex-row gap-1" accessibilityLabel="X-Ray scope">
          {scopes.map((value) => (
            <Button
              key={value}
              className="h-11 min-w-0 flex-1 px-1 sm:h-11"
              variant={scope === value ? "secondary" : "ghost"}
              accessibilityLabel={`X-Ray scope: ${xrayScopeLabels[value]}`}
              accessibilityState={{ selected: scope === value }}
              onPress={() => {
                setScope(value)
                setLastXrayScope(value)
              }}
            >
              <Text className="text-xs font-bold" numberOfLines={1}>
                {xrayScopeLabels[value]}
              </Text>
            </Button>
          ))}
        </View>
        <View
          className="flex-row gap-1"
          accessibilityLabel="X-Ray entity types"
        >
          {entityTypes.map((entry) => (
            <Button
              key={entry.type}
              className="h-11 min-w-0 flex-1 px-1 sm:h-11"
              variant={type === entry.type ? "secondary" : "ghost"}
              accessibilityLabel={`Filter X-Ray: ${entry.label}`}
              accessibilityHint="Select again to show all types"
              accessibilityState={{ selected: type === entry.type }}
              onPress={() => setType(type === entry.type ? null : entry.type)}
            >
              <Text className="text-xs" numberOfLines={1}>
                {entry.label}
              </Text>
            </Button>
          ))}
        </View>
      </View>
      <EntityList
        key={`${scope}:${type ?? "all"}`}
        className="flex-1"
        contentContainerClassName="px-2 pt-2"
        contentContainerStyle={{ paddingBottom }}
        data={scoped.entities}
        estimatedItemSize={96}
        recycleItems
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={
          scoped.scope !== scope && scoped.entities.length ? (
            <Text className="text-muted-foreground px-3 pb-2 text-xs">
              {scope === "now"
                ? "No names in the last few pages."
                : "No names in this chapter yet."}
              {` Showing ${xrayScopeLabels[scoped.scope].toLowerCase()}.`}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <Text className="text-muted-foreground px-6 py-8 text-center">
            {type
              ? `${entityTypes.find((entry) => entry.type === type)!.label} appear here once the book introduces them.`
              : "People, places, groups and things appear here once the book introduces them."}
          </Text>
        }
        renderItem={({ item }) => {
          const summary = getXrayEntitySummary(item)
          return (
            <Button
              className="active:bg-secondary my-0.5 h-auto flex-col items-stretch px-3 py-3 sm:h-auto"
              variant="ghost"
              accessibilityLabel={`Open X-Ray for ${item.name}, ${xrayEntityTypeLabels[item.type]}, ${item.mentions.length} mentions`}
              onPress={() => setEntityId(item.id)}
            >
              <View className="flex-row items-baseline justify-between gap-3">
                <Text
                  className="min-w-0 flex-1 text-sm font-bold"
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Text className="text-muted-foreground text-xs">
                  {item.mentions.length}{" "}
                  {item.mentions.length === 1 ? "mention" : "mentions"}
                </Text>
              </View>
              <Text className="text-muted-foreground text-xs">
                {xrayEntityTypeLabels[item.type]}
              </Text>
              {summary && (
                <Text className="text-sm" numberOfLines={1}>
                  {summary}
                </Text>
              )}
            </Button>
          )
        }}
      />
    </View>
  )
}

function XrayDetails({
  xray,
  entity,
  chapterLinks,
  format,
  onBack,
  onJump,
}: {
  xray: Xray
  entity: XrayEntityView
  chapterLinks: (XrayChapterLink | null)[]
  format: "readaloud" | "ebook" | "audiobook"
  onBack: () => void
  onJump: (ordinal: number) => void
}) {
  const paddingBottom = useReaderFormSheetScrollPaddingBottom()
  const [newestFirst, setNewestFirst] = useState(true)
  const rows = useMemo(
    () => getXrayDetailRows({ xray, entity, chapterLinks, newestFirst }),
    [xray, entity, chapterLinks, newestFirst],
  )
  const otherNames = entity.aliases.filter((alias) => alias !== entity.name)

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          onBack()
          return true
        },
      )
      return () => subscription.remove()
    }, [onBack]),
  )

  return (
    <View className="flex-1">
      <View className="border-border flex-row items-center justify-between gap-2 border-b px-2 py-1">
        <Button
          className="h-11 px-2 sm:h-11"
          variant="ghost"
          accessibilityLabel="Back to X-Ray list"
          onPress={onBack}
        >
          <Icon as={ArrowLeft} size={18} />
          <Text className="text-sm">All entries</Text>
        </Button>
        <Button
          className="h-11 px-2 sm:h-11"
          variant="ghost"
          accessibilityLabel={`Show ${newestFirst ? "oldest" : "newest"} mentions first`}
          onPress={() => setNewestFirst((value) => !value)}
        >
          <Icon as={ArrowUpDown} size={16} />
          <Text className="text-xs">
            {newestFirst ? "Newest first" : "Oldest first"}
          </Text>
        </Button>
      </View>
      <DetailList
        key={newestFirst ? "newest" : "oldest"}
        className="flex-1"
        contentContainerClassName="px-2 pt-2"
        contentContainerStyle={{ paddingBottom }}
        data={rows}
        estimatedItemSize={88}
        recycleItems
        getItemType={(item) => item.kind}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={
          <View className="gap-2 px-3 pt-2 pb-4">
            <Text variant="h3">{entity.name}</Text>
            <Text className="text-muted-foreground text-xs">
              {xrayEntityTypeLabels[entity.type]}
            </Text>
            {!!otherNames.length && (
              <Text className="text-sm">
                Other names: {otherNames.join(", ")}
              </Text>
            )}
            {entity.description && (
              <Text className="text-sm">{entity.description}</Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === "heading") {
            return (
              <Text
                className="px-3 pt-4 pb-2 text-sm font-bold"
                accessibilityRole="header"
              >
                {item.title}
              </Text>
            )
          }
          const canJump =
            format !== "audiobook" &&
            !!chapterLinks[chapterIndexOf(xray, item.ordinal)]?.type
          return (
            <Button
              className="active:bg-secondary my-0.5 h-auto items-start justify-start px-3 py-3 sm:h-auto"
              variant="ghost"
              disabled={!canJump}
              accessibilityLabel={`Go to ${item.kind === "fact" ? "key fact" : "mention"}: ${item.text}`}
              accessibilityHint={
                canJump
                  ? "Opens this passage in the book"
                  : "This passage is not available in the open edition"
              }
              onPress={() => onJump(item.ordinal)}
            >
              <Text className="flex-1 text-sm">{item.text}</Text>
            </Button>
          )
        }}
      />
    </View>
  )
}
