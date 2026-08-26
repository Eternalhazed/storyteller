import * as Linking from "expo-linking"
import { Search } from "lucide-react-native"
import { Alert, Pressable, StyleSheet } from "react-native"

import { useColorTheme } from "@/hooks/useColorTheme"
import { MoreHorizontalIcon } from "@/icons/MoreHorizontalIcon"
import { TrashIcon } from "@/icons/TrashIcon"
import { WikipediaIcon } from "@/icons/WikipediaIcon"
import { THEME } from "@/lib/theme"
import { logger } from "@/logger"

import {
  type SelectionLookupProvider,
  buildSelectionLookupUrl,
} from "./selectionLookup"

type Props = {
  deleteHighlightAction?: { onPress: () => void }
  expanded: boolean
  onCloseSelection: () => void
  onExpandedChange: (expanded: boolean) => void
  selectedText: string | null | undefined
}

const lookupActions = [
  { label: "Search Wikipedia", provider: "wikipedia" },
  { label: "Search Google", provider: "google" },
] satisfies ReadonlyArray<{
  label: string
  provider: SelectionLookupProvider
}>

export function SelectionLookupMenu({
  deleteHighlightAction,
  expanded,
  onCloseSelection,
  onExpandedChange,
  selectedText,
}: Props) {
  const { dark, foreground } = useColorTheme()

  const openLookup = async (provider: SelectionLookupProvider) => {
    const result = buildSelectionLookupUrl(provider, selectedText)

    if (!result.ok) {
      const message =
        result.reason === "empty"
          ? {
              body: "Select a word or phrase and try again.",
              title: "Nothing to look up",
            }
          : result.reason === "too-long"
            ? {
                body: "Select 500 characters or fewer and try again.",
                title: "Selection is too long",
              }
            : {
                body: "Select a different word or phrase and try again.",
                title: "Could not look up selection",
              }
      Alert.alert(message.title, message.body)
      return
    }

    onCloseSelection()

    try {
      await Linking.openURL(result.url)
    } catch {
      logger.error(`Failed to open ${provider} lookup`)
      Alert.alert(
        "Could not open lookup",
        "Check that an app or browser can open web links, then try again.",
      )
    }
  }

  if (!expanded) {
    return (
      <Pressable
        accessibilityLabel="Show selected-text lookups"
        accessibilityRole="button"
        accessibilityState={{ expanded: false }}
        onPress={() => onExpandedChange(true)}
        style={styles.action}
        testID="selection-lookup-menu-trigger"
      >
        <MoreHorizontalIcon />
      </Pressable>
    )
  }

  return (
    <>
      {deleteHighlightAction && (
        <Pressable
          accessibilityLabel="Delete highlight"
          accessibilityRole="button"
          onPress={deleteHighlightAction.onPress}
          style={styles.action}
          testID="selection-delete-highlight"
        >
          <TrashIcon color={THEME[dark ? "dark" : "light"].destructive} />
        </Pressable>
      )}
      {lookupActions.map(({ label, provider }) => (
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          key={provider}
          onPress={() => void openLookup(provider)}
          style={styles.action}
          testID={`selection-lookup-${provider}`}
        >
          {provider === "wikipedia" ? (
            <WikipediaIcon />
          ) : (
            <Search color={foreground} size={22} />
          )}
        </Pressable>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
})
