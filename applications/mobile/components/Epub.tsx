import deepmerge from "deepmerge"
import Constants from "expo-constants"
import { useKeepAwake } from "expo-keep-awake"
import { Tabs, useRouter } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  DeviceEventEmitter,
  StatusBar,
  TouchableOpacity,
  View,
} from "react-native"

import { type Bookmark } from "@/database/bookmarks"
import { type BookWithRelations } from "@/database/books"
import { deepEquals } from "@/deepEquals"
import { useColorTheme } from "@/hooks/useColorTheme"
import { cn } from "@/lib/utils"
import { logger } from "@/logger"
import { EPUBView } from "@/modules/readium"
import {
  type EPUBViewRef,
  type ReadiumLocator,
} from "@/modules/readium/src/Readium.types"
import { bookDoubleTapped, bookLocatorChanged } from "@/store/actions"
import { useAppDispatch, useAppSelector } from "@/store/appState"
import {
  useGetBookBookmarksQuery,
  useGetBookHighlightsQuery,
  useGetBookPreferencesQuery,
  useGetGlobalPreferencesQuery,
  useUpdateGlobalPreferenceMutation,
} from "@/store/localApi"
import { getCustomFontUrl } from "@/store/persistence/fonts"
import { getIsPlaying } from "@/store/selectors/bookshelfSelectors"
import { getShouldKeepReaderAwake } from "@/store/selectors/sleepTimerSelectors"
import { bookshelfSlice } from "@/store/slices/bookshelfSlice"
import { type XraySelection } from "@/store/xraySelection"
import { type UUID } from "@/uuid"

import { BackButton } from "./BackButton"
import { DefinitionPopover } from "./DefinitionPopover"
import { LoadingView } from "./LoadingView"
import { MiniPlayer } from "./MiniPlayer"
import { SelectionMenu } from "./SelectionMenu"
import { Toolbar } from "./Toolbar"
import { XrayPopover } from "./XrayPopover"
import { Group } from "./ui/Group"
import { HideableView } from "./ui/HideableView"

type Props = {
  book: BookWithRelations
  format: "readaloud" | "ebook"
  locator: ReadiumLocator
}

const forwardNavKeyCodes = [93, 117]
const backwardNavKeyCodes = [92]

function EpubKeepAwake() {
  useKeepAwake()
  return null
}

export function Epub({ book, format, locator }: Props) {
  const shouldKeepAwake = useAppSelector(getShouldKeepReaderAwake)

  const { foreground, background } = useColorTheme()
  const [activeBookmarks, setActiveBookmarks] = useState<Bookmark[]>([])

  const {
    data: bookPreferences,
    isLoading: isLoadingBookPreferences,
    isUninitialized: isBookPreferencesUnitialized,
  } = useGetBookPreferencesQuery({ uuid: book.uuid })

  const {
    data: globalPreferences,
    isLoading: isLoadingGlobalPreferences,
    isUninitialized: isGlobalPreferencesUninitialized,
  } = useGetGlobalPreferencesQuery()

  const [updateGlobalPreference] = useUpdateGlobalPreferenceMutation()

  const isLoadingPreferences =
    isLoadingBookPreferences || isLoadingGlobalPreferences
  const isPreferencesUninitialized =
    isBookPreferencesUnitialized || isGlobalPreferencesUninitialized

  const preferences = useMemo(
    () =>
      bookPreferences
        ? globalPreferences && deepmerge(globalPreferences, bookPreferences)
        : globalPreferences,
    [globalPreferences, bookPreferences],
  )
  const hideStatusbar = preferences?.hideStatusbar

  const { data: highlights } = useGetBookHighlightsQuery({
    bookUuid: book.uuid,
  })

  const { data: bookmarks } = useGetBookBookmarksQuery({
    bookUuid: book.uuid,
  })

  const customFonts = preferences?.customFonts

  const [selection, setSelection] = useState<{
    x: number
    y: number
    highlightUuid?: UUID
  } | null>(null)
  const [definition, setDefinition] = useState<{
    term: string
    x: number
    y: number
  } | null>(null)
  const [xrayCard, setXrayCard] = useState<
    (XraySelection & { x: number; y: number }) | null
  >(null)
  const [toolbarHeight, setToolbarHeight] = useState(0)

  const closeSelection = () => {
    setSelection(null)
    // Drop the WebView's selection handles too; otherwise they linger after
    // an action and float above the definition popover.
    void epubViewRef.current?.clearSelection()
  }

  const dispatch = useAppDispatch()

  useEffect(() => {
    if (!hideStatusbar?.enabled) return

    StatusBar.setHidden(!preferences?.showReaderUi)

    return () => {
      StatusBar.setHidden(false)
    }
  }, [hideStatusbar?.enabled, preferences?.showReaderUi])

  const epubViewRef = useRef<EPUBViewRef | null>(null)

  const getCurrentSelection =
    useCallback(async (): Promise<ReadiumLocator | null> => {
      try {
        // Android opens the toolbar before the reader finishes changing the range.
        return (await epubViewRef.current?.getCurrentSelection()) ?? null
      } catch {
        logger.error("Failed to read the current EPUB selection")
        return null
      }
    }, [])

  const isPlaying = useAppSelector(getIsPlaying)

  const floatingToolbar = preferences?.floatingToolbar
  // Selection events are relative to the reader view, which sits below the
  // toolbar (or the status bar when the toolbar floats).
  const selectionY =
    (selection?.y ?? 0) +
    (floatingToolbar ? Constants.statusBarHeight : toolbarHeight)

  const showingFootnote = useAppSelector(
    (state) => state.bookshelf.footnoteContent !== null,
  )

  const router = useRouter()

  useEffect(() => {
    const listener = DeviceEventEmitter.addListener(
      "storyteller:keydown",
      (event) => {
        if (forwardNavKeyCodes.includes(event.keyCode)) {
          epubViewRef.current?.goForward()
        } else if (backwardNavKeyCodes.includes(event.keyCode)) {
          epubViewRef.current?.goBackward()
        }
      },
    )

    return () => listener.remove()
  }, [])

  if (isLoadingPreferences || isPreferencesUninitialized) {
    return (
      <View className="bg-background flex-1">
        {shouldKeepAwake && <EpubKeepAwake />}
        <LoadingView />
      </View>
    )
  }

  return (
    <View className="bg-background flex-1">
      {shouldKeepAwake && <EpubKeepAwake />}
      {showingFootnote && (
        <TouchableOpacity
          className="absolute top-0 right-0 bottom-0 left-0 z-100"
          onPress={() => {
            if (!showingFootnote) return
            router.dismiss()
          }}
        />
      )}
      <Tabs.Screen options={{ tabBarStyle: { display: "none" } }} />
      <HideableView hidden={!preferences?.showReaderUi} className="relative">
        <Group
          className={cn("px-sticky z-3 flex-row items-center justify-between", {
            "bg-background border-b-foreground absolute right-0 left-0 border-b":
              floatingToolbar,
          })}
          style={{
            paddingTop: Constants.statusBarHeight,
          }}
          onLayout={(event) => {
            setToolbarHeight(event.nativeEvent.layout.height)
          }}
        >
          <BackButton />
          <Toolbar mode="text" activeBookmarks={activeBookmarks} />
        </Group>
      </HideableView>
      {selection && (
        <SelectionMenu
          bookUuid={book.uuid}
          x={selection.x}
          y={selectionY}
          getCurrentSelection={getCurrentSelection}
          existingHighlight={selection.highlightUuid ?? null}
          onClose={closeSelection}
          onDefine={(term) => {
            setDefinition({ term, x: selection.x, y: selectionY })
            closeSelection()
          }}
          onXray={(result) => {
            setDefinition(null)
            setXrayCard({ ...result, x: selection.x, y: selectionY })
            closeSelection()
          }}
        />
      )}
      {definition && (
        <DefinitionPopover
          term={definition.term}
          x={definition.x}
          y={definition.y}
          onClose={() => setDefinition(null)}
        />
      )}
      {xrayCard && (
        <XrayPopover
          entity={xrayCard.entity}
          x={xrayCard.x}
          y={xrayCard.y}
          onClose={() => setXrayCard(null)}
          onAllMentions={() => {
            router.push({
              pathname: "/navigation-menu/xray",
              params: {
                uuid: book.uuid,
                format,
                mode: "text",
                entityId: String(xrayCard.entity.id),
                selectionBoundary: String(xrayCard.boundary),
              },
            })
            setXrayCard(null)
          }}
        />
      )}
      <View
        className={cn("z-1 flex-1", {
          "pb-safe-or-2": floatingToolbar,
        })}
        style={
          floatingToolbar && {
            paddingTop: Constants.statusBarHeight,
          }
        }
      >
        <EPUBView
          ref={epubViewRef}
          style={{ flex: 1 }}
          bookUuid={book.uuid}
          locator={locator}
          highlights={highlights ?? []}
          bookmarks={bookmarks?.map((bookmark) => bookmark.locator) ?? []}
          fontScale={preferences?.typography?.scale}
          lineHeight={preferences?.typography?.lineHeight}
          textAlign={preferences?.typography?.alignment}
          fontFamily={preferences?.typography?.fontFamily}
          marginLeft={preferences?.layout.marginLeft}
          marginRight={preferences?.layout.marginRight}
          readaloudColor={preferences?.readaloudColor}
          readaloudDecoratorStyle={preferences?.readaloudDecoratorStyle}
          scrollMode={preferences?.layout.scroll ?? false}
          colorTheme={{ foreground, background }}
          customFonts={customFonts?.map((font) => ({
            ...font,
            uri: getCustomFontUrl(font.filename),
          }))}
          onHighlightTap={(event) => {
            setSelection({
              x: event.nativeEvent.x,
              y: event.nativeEvent.y,
              highlightUuid: event.nativeEvent.decoration,
            })
          }}
          onBookmarksActivate={(event) => {
            const activeLocators = event.nativeEvent.activeBookmarks
            setActiveBookmarks(
              bookmarks?.filter((bookmark) =>
                activeLocators.some((locator) => {
                  const { target: _, ...bookmarkLocator } = bookmark.locator
                  return deepEquals(bookmarkLocator, locator)
                }),
              ) ?? [],
            )
          }}
          onLocatorChange={(event) => {
            if (isPlaying) {
              return
            }

            dispatch(
              bookLocatorChanged({
                bookUuid: book.uuid,
                locator: event.nativeEvent,
                timestamp: Date.now(),
              }),
            )
          }}
          onMiddleTouch={() => {
            updateGlobalPreference({
              name: "showReaderUi",
              value: !preferences?.showReaderUi,
            })
          }}
          onDoubleTouch={(event) => {
            dispatch(
              bookDoubleTapped({
                bookUuid: book.uuid,
                locator: event.nativeEvent,
                timestamp: Date.now(),
              }),
            )
          }}
          onSelection={(event) => {
            if ("cleared" in event.nativeEvent) {
              setSelection((current) =>
                current?.highlightUuid ? current : null,
              )
            } else {
              const { x, y } = event.nativeEvent
              setSelection({ x, y })
            }
          }}
          onShowFootnote={(event) => {
            dispatch(
              bookshelfSlice.actions.footnoteOpened({
                content: event.nativeEvent.content,
              }),
            )
          }}
          isPlaying={isPlaying}
        />
      </View>
      <MiniPlayer
        floatingToolbar={floatingToolbar ?? false}
        hidden={!preferences?.showReaderUi}
        book={book}
        format={format}
      />
    </View>
  )
}
