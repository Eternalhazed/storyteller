import { LegendList } from "@legendapp/list/react-native"
import { skipToken } from "@reduxjs/toolkit/query"
import { useFocusEffect } from "expo-router"
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronRight,
  ListChecks,
  TextQuote,
} from "lucide-react-native"
import { useCallback, useMemo, useState } from "react"
import { BackHandler, type ScrollViewProps, View } from "react-native"
import { ScrollView } from "react-native-gesture-handler"
import { withUniwind } from "uniwind"

import {
  type Xray,
  type XrayEntityView,
  chapterIndexOf,
  viewXray,
} from "@storyteller/xray/view"

import { LoadingView } from "@/components/LoadingView"
import { XrayTypeBadge, xrayEntityTypeIcons } from "@/components/XrayTypeBadge"
import { useReaderFormSheetScrollPaddingBottom } from "@/components/toolbarItems/readerFormSheetLayout"
import { ButtonGroup, ButtonGroupButton } from "@/components/ui/ButtonGroup"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Text } from "@/components/ui/text"
import { useIsFocused } from "@/hooks/useIsFocused"
import { cn } from "@/lib/utils"
import { useAppDispatch, useAppSelector } from "@/store/appState"
import { passageSlice } from "@/store/slices/passageSlice"
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
  splitXrayNames,
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

// The same scroll view the other reader menu tabs use. Without it, a swipe
// down inside a scrolled list closes the sheet instead of scrolling back up.
function renderSheetScrollView(props: ScrollViewProps) {
  return <ScrollView {...props} />
}

function EntitySeparator() {
  return <View className="bg-border ml-[60px] h-px" />
}

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
        !returnPosition &&
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
    if (!jump || !currentLocator) return
    dispatch(
      passageSlice.actions.jump({
        bookUuid,
        format,
        surface: mode,
        purpose: "reference",
        origin: jump.currentLocator ?? currentLocator,
        target: { locator: jump.locator },
      }),
    )
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
      <View className="border-border gap-3 border-b px-3 pt-2 pb-3">
        <ButtonGroup
          className="bg-secondary rounded-md"
          value={scope}
          onChange={(value: XrayScope) => {
            setScope(value)
            setLastXrayScope(value)
          }}
        >
          {scopes.map((value) => (
            <ButtonGroupButton
              key={value}
              value={value}
              className="h-10 min-w-0 flex-1 px-1 sm:h-10"
              accessibilityLabel={`X-Ray scope: ${xrayScopeLabels[value]}`}
            >
              <Text className="text-sm font-medium" numberOfLines={1}>
                {xrayScopeLabels[value]}
              </Text>
            </ButtonGroupButton>
          ))}
        </ButtonGroup>
        <View
          className="flex-row flex-wrap gap-2"
          accessibilityLabel="X-Ray entity types"
        >
          {entityTypes.map((entry) => {
            const selected = type === entry.type
            return (
              <Button
                key={entry.type}
                className={cn(
                  "h-9 flex-row items-center gap-1.5 rounded-full px-3 sm:h-9",
                  selected && "border-primary bg-primary/10",
                )}
                variant="outline"
                size="sm"
                hitSlop={{ top: 6, bottom: 6 }}
                accessibilityLabel={`Filter X-Ray: ${entry.label}`}
                accessibilityHint="Select again to show all types"
                accessibilityState={{ selected }}
                onPress={() => setType(selected ? null : entry.type)}
              >
                <Icon
                  as={xrayEntityTypeIcons[entry.type]}
                  size={14}
                  className={
                    selected ? "text-primary" : "text-muted-foreground"
                  }
                />
                <Text
                  className={cn(
                    "text-xs",
                    selected && "text-primary font-semibold",
                  )}
                  numberOfLines={1}
                >
                  {entry.label}
                </Text>
              </Button>
            )
          })}
        </View>
      </View>
      <EntityList
        key={`${scope}:${type ?? "all"}`}
        className="flex-1"
        contentContainerClassName="pt-1"
        contentContainerStyle={{ paddingBottom }}
        data={scoped.entities}
        estimatedItemSize={84}
        ItemSeparatorComponent={EntitySeparator}
        recycleItems
        renderScrollComponent={renderSheetScrollView}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={
          scoped.scope !== scope && scoped.entities.length ? (
            <Text className="text-muted-foreground px-3 pt-2 pb-1 text-xs">
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
              className="active:bg-secondary h-auto flex-row items-start justify-start gap-3 rounded-none px-3 py-3 sm:h-auto"
              variant="ghost"
              accessibilityLabel={`Open X-Ray for ${item.name}, ${xrayEntityTypeLabels[item.type]}, ${item.mentions.length} mentions`}
              onPress={() => setEntityId(item.id)}
            >
              <XrayTypeBadge type={item.type} />
              <View className="min-w-0 flex-1 gap-0.5">
                <View className="flex-row items-baseline justify-between gap-3">
                  <Text
                    className="min-w-0 flex-1 text-base font-semibold"
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text className="text-muted-foreground text-xs">
                    {item.mentions.length}{" "}
                    {item.mentions.length === 1 ? "mention" : "mentions"}
                  </Text>
                </View>
                {summary && (
                  <Text
                    className="text-muted-foreground text-sm leading-5 font-normal"
                    numberOfLines={2}
                  >
                    {summary}
                  </Text>
                )}
              </View>
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
  const names = useMemo(
    () => [entity.name, ...entity.aliases],
    [entity.name, entity.aliases],
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
          accessibilityLabel={`Sorted ${newestFirst ? "newest" : "oldest"} first`}
          accessibilityHint={`Shows facts and mentions ${newestFirst ? "oldest" : "newest"} first`}
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
        contentContainerClassName="pt-1"
        contentContainerStyle={{ paddingBottom }}
        data={rows}
        estimatedItemSize={64}
        recycleItems
        renderScrollComponent={renderSheetScrollView}
        getItemType={(item) => item.kind}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={
          <View className="gap-3 px-3 pt-3 pb-1">
            <View className="flex-row items-center gap-3">
              <XrayTypeBadge type={entity.type} size="header" />
              <View className="min-w-0 flex-1 gap-0.5">
                <Text variant="h3">{entity.name}</Text>
                <Text className="text-muted-foreground text-xs">
                  {xrayEntityTypeLabels[entity.type]}
                  {" · "}
                  {entity.mentions.length}{" "}
                  {entity.mentions.length === 1 ? "mention" : "mentions"} so far
                </Text>
              </View>
            </View>
            {!!otherNames.length && (
              <Text className="text-muted-foreground text-sm">
                Also called {otherNames.join(", ")}
              </Text>
            )}
            {entity.description && (
              <Text className="text-base leading-6">{entity.description}</Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === "section") {
            return (
              <View className="border-border mt-3 flex-row items-center gap-1.5 border-t px-3 pt-4 pb-1">
                <Icon
                  as={item.key === "facts" ? ListChecks : TextQuote}
                  size={16}
                  className="text-muted-foreground"
                />
                <Text
                  className="text-muted-foreground min-w-0 flex-1 text-sm"
                  accessibilityRole="header"
                >
                  {item.title}
                </Text>
                <Text className="text-muted-foreground text-xs">
                  {item.count}
                </Text>
              </View>
            )
          }
          if (item.kind === "chapter") {
            return (
              <View className="flex-row items-baseline justify-between gap-3 px-3 pt-4 pb-1">
                <Text
                  className="min-w-0 flex-1 text-xs font-semibold"
                  accessibilityRole="header"
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                <Text className="text-muted-foreground text-xs">
                  {item.count}
                </Text>
              </View>
            )
          }
          const canJump =
            format !== "audiobook" &&
            !!chapterLinks[chapterIndexOf(xray, item.ordinal)]?.type
          const jumpProps = {
            variant: "ghost",
            disabled: !canJump,
            accessibilityHint: canJump
              ? "Opens this passage in the book"
              : "This passage is not available in the open edition",
            onPress: () => onJump(item.ordinal),
          } as const
          if (item.kind === "fact") {
            return (
              <Button
                {...jumpProps}
                className="active:bg-secondary h-auto flex-row items-start justify-start gap-3 rounded-none px-3 py-2.5 sm:h-auto"
                accessibilityLabel={`Go to key fact: ${item.text}`}
              >
                <View className="bg-muted-foreground mt-2 h-1.5 w-1.5 rounded-full" />
                <Text className="min-w-0 flex-1 text-sm leading-5 font-normal">
                  {item.text}
                </Text>
                <Icon
                  as={ChevronRight}
                  size={16}
                  className="text-muted-foreground mt-0.5"
                />
              </Button>
            )
          }
          return (
            <Button
              {...jumpProps}
              className="active:bg-secondary h-auto items-stretch justify-start rounded-none px-3 py-1.5 sm:h-auto"
              accessibilityLabel={`Go to mention: ${item.text}`}
            >
              <View className="border-border min-w-0 flex-1 border-l-2 py-0.5 pl-3">
                <Text className="text-sm leading-5 font-normal">
                  {splitXrayNames(item.text, names).map((part, index) =>
                    part.name ? (
                      <Text key={index} className="text-sm font-semibold">
                        {part.text}
                      </Text>
                    ) : (
                      part.text
                    ),
                  )}
                </Text>
              </View>
            </Button>
          )
        }}
      />
    </View>
  )
}
