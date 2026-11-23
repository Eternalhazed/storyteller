import Clipboard from "@react-native-clipboard/clipboard"
import { skipToken } from "@reduxjs/toolkit/query"
import { ChevronLeft } from "lucide-react-native"
import { useEffect, useMemo, useState } from "react"
import {
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { findEntity, viewXray } from "@storyteller/xray/view"

import { type HighlightTint, highlightTints } from "@/colors"
import { defaultPreferences } from "@/database/preferencesTypes"
import { useColorTheme } from "@/hooks/useColorTheme"
import { CopyIcon } from "@/icons/CopyIcon"
import { TrashIcon } from "@/icons/TrashIcon"
import { THEME } from "@/lib/theme"
import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"
import { useAppSelector } from "@/store/appState"
import {
  useCreateHighlightMutation,
  useDeleteHighlightMutation,
  useGetBookQuery,
  useGetBookXrayQuery,
  useGetGlobalPreferencesQuery,
  useGetHighlightQuery,
  useUpdateGlobalPreferenceMutation,
  useUpdateHighlightMutation,
} from "@/store/localApi"
import {
  getIsPlaying,
  getReturnToPosition,
} from "@/store/selectors/bookshelfSelectors"
import { getXrayBoundary } from "@/store/xrayBoundary"
import {
  type XraySelection,
  getSelectionXray,
  getXraySelectionBoundary,
} from "@/store/xraySelection"
import { type UUID, randomUUID } from "@/uuid"

import { HighlightColorPicker, HighlightSwatch } from "./HighlightColorPicker"
import {
  SelectionLookupActions,
  getSelectionLookupActionCount,
} from "./SelectionLookupActions"
import {
  SELECTION_TOOLBAR_ACTION_SIZE,
  getSelectionToolbarLayout,
} from "./selectionToolbarLayout"

const HIGHLIGHT_COLOR_COUNT = Object.keys(highlightTints.light).length

type Props = {
  bookUuid: UUID
  x: number
  y: number
  getCurrentSelection: () => Promise<ReadiumLocator | null>
  existingHighlight?: UUID | null
  onClose: () => void
  onDefine: (term: string) => void
  onXray: (selection: XraySelection) => void
}

export function SelectionMenu({
  bookUuid,
  x,
  y,
  getCurrentSelection,
  existingHighlight: highlightUuid,
  onClose,
  onDefine,
  onXray,
}: Props) {
  const dimensions = useWindowDimensions()
  const { top: topInset } = useSafeAreaInsets()
  const { background, dark, foreground } = useColorTheme()
  const [createHighlight] = useCreateHighlightMutation()
  const [updateHighlight] = useUpdateHighlightMutation()
  const [deleteHighlight] = useDeleteHighlightMutation()
  const [updateGlobalPreference] = useUpdateGlobalPreferenceMutation()
  const { data: preferences } = useGetGlobalPreferencesQuery()
  const [showColors, setShowColors] = useState(false)
  const { currentData: existingHighlight } = useGetHighlightQuery(
    highlightUuid ? { uuid: highlightUuid } : skipToken,
  )
  const { data: book } = useGetBookQuery({ uuid: bookUuid })
  const { data: xray } = useGetBookXrayQuery({ bookUuid })
  const returnPosition = useAppSelector((state) =>
    getReturnToPosition(state, bookUuid),
  )
  const isPlaying = useAppSelector(getIsPlaying)
  const [liveSelection, setLiveSelection] = useState<ReadiumLocator | null>(
    null,
  )
  const readerBoundary = useMemo(
    () =>
      getXrayBoundary({
        xray,
        locator: book?.position?.locator,
        mode: "text",
        isPlaying,
        returnPosition,
      }),
    [xray, book?.position?.locator, isPlaying, returnPosition],
  )
  const selectionLocator = existingHighlight?.locator ?? liveSelection
  const selectedText = selectionLocator?.text?.highlight ?? ""
  const hasSelection = !!selectedText.trim()
  const selectionBoundary = useMemo(
    () =>
      returnPosition
        ? readerBoundary
        : getXraySelectionBoundary({
            xray,
            readerBoundary,
            readerLocator: book?.position?.locator,
            selection: selectionLocator,
          }),
    [
      xray,
      readerBoundary,
      book?.position?.locator,
      selectionLocator,
      returnPosition,
    ],
  )
  const selectionViews = useMemo(
    () => (xray && hasSelection ? viewXray(xray, selectionBoundary) : []),
    [xray, selectionBoundary, hasSelection],
  )
  const selectedXray = useMemo(() => {
    if (!selectedText.trim() || !selectionViews.length) return null
    const entity = findEntity(selectionViews, selectedText)
    return entity ? { boundary: selectionBoundary, entity } : null
  }, [selectionViews, selectionBoundary, selectedText])

  useEffect(() => {
    if (!xray?.entities.length || highlightUuid) return
    let closed = false
    let timer = setTimeout(() => void refreshSelection(), 0)
    async function refreshSelection() {
      const locator = await getCurrentSelection()
      if (closed) return
      setLiveSelection((previous) =>
        previous?.href === locator?.href &&
        previous?.locations?.progression === locator?.locations?.progression &&
        previous?.text?.highlight === locator?.text?.highlight
          ? previous
          : locator,
      )
      // Android only emits selection-cleared changes while handles are dragged;
      // read the live range while this menu is open, as the other actions do.
      timer = setTimeout(() => void refreshSelection(), 250)
    }
    return () => {
      closed = true
      clearTimeout(timer)
    }
  }, [xray, highlightUuid, getCurrentSelection])

  // A highlight tap reports the reader position rather than the highlight,
  // so wait for the highlight before offering actions on its text or color.
  if (highlightUuid && !existingHighlight) return null

  const getSelectedText = async () => {
    const locator = existingHighlight?.locator ?? (await getCurrentSelection())
    return locator?.text?.highlight
  }
  const swatchColor =
    existingHighlight?.color ??
    preferences?.highlightColor ??
    defaultPreferences.highlightColor

  const applyColor = async (color: HighlightTint) => {
    if (existingHighlight) {
      updateHighlight({ highlightId: existingHighlight.uuid, color })
    } else {
      const locator = await getCurrentSelection()
      if (!locator) return
      createHighlight({ highlightId: randomUUID(), color, locator, bookUuid })
    }

    if (color !== preferences?.highlightColor) {
      updateGlobalPreference({ name: "highlightColor", value: color })
    }

    onClose()
  }

  const copySelection = async () => {
    const text = await getSelectedText()
    if (text !== undefined) Clipboard.setString(text)
    onClose()
  }

  const toolbarLayout = getSelectionToolbarLayout({
    // Colors: back + palette. Actions: swatch, copy, lookups, and delete.
    actionCount: showColors
      ? 1 + HIGHLIGHT_COLOR_COUNT
      : 2 +
        getSelectionLookupActionCount(!!selectedXray) +
        (existingHighlight ? 1 : 0),
    topInset,
    width: dimensions.width,
    x,
    y,
  })

  return (
    <>
      <View
        style={[
          styles.menu,
          {
            backgroundColor: background,
            height: toolbarLayout.height,
            left: toolbarLayout.left,
            top: toolbarLayout.top,
            width: toolbarLayout.width,
          },
        ]}
      >
        {showColors ? (
          <>
            <Pressable
              accessibilityLabel="Back to selection actions"
              accessibilityRole="button"
              onPress={() => setShowColors(false)}
              style={styles.action}
              testID="selection-colors-back"
            >
              <ChevronLeft color={foreground} size={22} />
            </Pressable>
            <HighlightColorPicker
              value={existingHighlight?.color}
              onChange={(color) => void applyColor(color)}
            />
          </>
        ) : (
          <>
            <HighlightSwatch
              accessibilityActions={[
                { name: "longpress", label: "Choose highlight color" },
              ]}
              accessibilityHint={
                existingHighlight
                  ? "Shows the highlight colors"
                  : "Long press to choose a different color"
              }
              accessibilityLabel={
                existingHighlight
                  ? "Change highlight color"
                  : `Highlight in ${swatchColor}`
              }
              color={swatchColor}
              selected={Boolean(existingHighlight)}
              testID="selection-highlight"
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "longpress") {
                  setShowColors(true)
                }
              }}
              onLongPress={() => setShowColors(true)}
              onPress={() => {
                if (existingHighlight) {
                  setShowColors(true)
                } else {
                  void applyColor(swatchColor)
                }
              }}
            />
            <Pressable
              accessibilityLabel="Copy selected text"
              accessibilityRole="button"
              style={styles.action}
              onPress={() => void copySelection()}
            >
              <CopyIcon />
            </Pressable>
            <SelectionLookupActions
              getSelectedText={getSelectedText}
              onCloseSelection={onClose}
              onDefine={onDefine}
              onXray={
                selectedXray
                  ? async () => {
                      const selection =
                        existingHighlight?.locator ??
                        (await getCurrentSelection())
                      setLiveSelection(selection)
                      const latest = getSelectionXray({
                        xray,
                        readerBoundary,
                        freezeBoundary: !!returnPosition,
                        readerLocator: book?.position?.locator,
                        selection,
                      })
                      if (latest) onXray(latest)
                    }
                  : undefined
              }
            />
            {existingHighlight && (
              <Pressable
                accessibilityLabel="Delete highlight"
                accessibilityRole="button"
                onPress={() => {
                  deleteHighlight({ uuid: existingHighlight.uuid })
                  onClose()
                }}
                style={styles.action}
                testID="selection-delete-highlight"
              >
                <TrashIcon color={THEME[dark ? "dark" : "light"].destructive} />
              </Pressable>
            )}
          </>
        )}
      </View>
      {existingHighlight && (
        <TouchableOpacity
          accessibilityLabel="Close selection menu"
          accessibilityRole="button"
          style={styles.backdrop}
          onPress={onClose}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    zIndex: 1000,
    flexDirection: "row",
    flexWrap: "wrap",
    borderRadius: 8,
    // shadow* only renders on iOS; Android needs elevation to lift the
    // toolbar off the page instead of blending into the text behind it.
    elevation: 6,
    shadowRadius: 4,
    shadowOpacity: 0.3,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowColor: "black",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
  action: {
    alignItems: "center",
    height: SELECTION_TOOLBAR_ACTION_SIZE,
    justifyContent: "center",
    width: SELECTION_TOOLBAR_ACTION_SIZE,
  },
})
