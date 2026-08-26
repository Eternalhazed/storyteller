import Clipboard from "@react-native-clipboard/clipboard"
import { skipToken } from "@reduxjs/toolkit/query"
import { useState } from "react"
import {
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useColorTheme } from "@/hooks/useColorTheme"
import { CopyIcon } from "@/icons/CopyIcon"
import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"
import {
  useCreateHighlightMutation,
  useDeleteHighlightMutation,
  useGetHighlightQuery,
  useUpdateHighlightMutation,
} from "@/store/localApi"
import { type UUID, randomUUID } from "@/uuid"

import { HighlightColorPicker } from "./HighlightColorPicker"
import { SelectionLookupMenu } from "./SelectionLookupMenu"
import { getSelectionToolbarLayout } from "./selectionToolbarLayout"

const COLLAPSED_TOOLBAR_ACTION_COUNT = 7

type Props = {
  bookUuid: UUID
  x: number
  y: number
  locator: ReadiumLocator
  existingHighlight?: UUID | null
  onClose: () => void
}

export function SelectionMenu({
  bookUuid,
  x,
  y,
  locator,
  existingHighlight: highlightUuid,
  onClose,
}: Props) {
  const dimensions = useWindowDimensions()
  const { top: topInset } = useSafeAreaInsets()
  const { background } = useColorTheme()
  const [createHighlight] = useCreateHighlightMutation()
  const [updateHighlight] = useUpdateHighlightMutation()
  const [deleteHighlight] = useDeleteHighlightMutation()
  const [lookupExpanded, setLookupExpanded] = useState(false)
  const { data: existingHighlight } = useGetHighlightQuery(
    highlightUuid ? { uuid: highlightUuid } : skipToken,
  )

  const selectedText = (existingHighlight?.locator ?? locator).text?.highlight
    ?.toString()
  const toolbarActionCount =
    COLLAPSED_TOOLBAR_ACTION_COUNT -
    1 +
    (lookupExpanded ? 2 + Number(Boolean(existingHighlight)) : 1)
  const toolbarLayout = getSelectionToolbarLayout({
    actionCount: toolbarActionCount,
    collapsedActionCount: COLLAPSED_TOOLBAR_ACTION_COUNT,
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
        <HighlightColorPicker
          value={existingHighlight?.color}
          onChange={(color) => {
            if (existingHighlight) {
              updateHighlight({ highlightId: existingHighlight.uuid, color })
              onClose()
              return
            }

            createHighlight({
              highlightId: randomUUID(),
              color,
              locator,
              bookUuid,
            })
            onClose()
          }}
        />
        <Pressable
          accessibilityLabel="Copy selected text"
          accessibilityRole="button"
          style={styles.copyButton}
          onPress={() => {
            Clipboard.setString(selectedText ?? "")
            onClose()
          }}
        >
          <CopyIcon />
        </Pressable>
        <SelectionLookupMenu
          expanded={lookupExpanded}
          selectedText={selectedText}
          onCloseSelection={onClose}
          onExpandedChange={setLookupExpanded}
          {...(existingHighlight
            ? {
                deleteHighlightAction: {
                  onPress: () => {
                    deleteHighlight({ uuid: existingHighlight.uuid })
                    onClose()
                  },
                },
              }
            : {})}
        />
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
  button: {
    width: 24,
    height: 24,
    borderRadius: 12,
    margin: 8,
    borderWidth: 1,
    borderColor: "#AAA",
  },
  copyButton: {
    width: 24,
    height: 24,
    margin: 8,
  },
})
