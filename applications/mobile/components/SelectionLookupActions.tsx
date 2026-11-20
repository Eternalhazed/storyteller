import * as Linking from "expo-linking"
import { BookA, ScanSearch, Search } from "lucide-react-native"
import { Alert, Platform, Pressable, StyleSheet } from "react-native"

import { useColorTheme } from "@/hooks/useColorTheme"
import { WikipediaIcon } from "@/icons/WikipediaIcon"
import { logger } from "@/logger"
import ReadiumModule from "@/modules/readium/src/ReadiumModule"

import {
  type SelectionLookupProvider,
  openSelectionLookup,
} from "./selectionLookup"
import { SELECTION_TOOLBAR_ACTION_SIZE } from "./selectionToolbarLayout"
import {
  MAX_DEFINITION_TERM_WORDS,
  getDefinitionTerm,
} from "./wiktionaryDefinitions"

type Props = {
  onCloseSelection: () => void
  /** Receives the dictionary headword; the reader shows the definition. */
  onDefine: (term: string) => void
  getSelectedText: () => Promise<string | undefined>
  onXray?: (() => void) | undefined
}

const webLookups = [
  { label: "Search Wikipedia", provider: "wikipedia" },
  { label: "Search Google", provider: "google" },
] satisfies ReadonlyArray<{
  label: string
  provider: SelectionLookupProvider
}>

/** Define, web lookups, and the optional selection-specific X-Ray action. */
export function getSelectionLookupActionCount(hasXray: boolean) {
  return 1 + webLookups.length + Number(hasXray)
}

async function openWikipediaApp(query: string, url: string): Promise<boolean> {
  if (Platform.OS === "android") {
    return ReadiumModule.openWikipediaSearch(query)
  }
  if (Platform.OS === "ios") {
    try {
      return await Linking.openURL(
        url.replace(/^https:/u, "wikipedia-official:"),
      )
    } catch {
      return false
    }
  }
  return false
}

export function SelectionLookupActions({
  onCloseSelection,
  onDefine,
  getSelectedText,
  onXray,
}: Props) {
  const { foreground } = useColorTheme()

  const openDefinition = async () => {
    const result = getDefinitionTerm(await getSelectedText())

    if (!result.ok) {
      if (result.reason === "empty") {
        Alert.alert(
          "Nothing to define",
          "Select a word or phrase and try again.",
        )
      } else {
        Alert.alert(
          "Selection is too long",
          `Select ${MAX_DEFINITION_TERM_WORDS} words or fewer to see a definition.`,
        )
      }
      return
    }

    onDefine(result.term)
  }

  const openWebLookup = async (provider: SelectionLookupProvider) => {
    try {
      const result = await openSelectionLookup(provider, getSelectedText, {
        onOpen: onCloseSelection,
        openUrl: Linking.openURL,
        openWikipediaApp,
      })
      if (result.ok) return
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
    } catch {
      logger.error(`Failed to open ${provider} lookup`)
      Alert.alert(
        "Could not open lookup",
        "Check that an app or browser can open web links, then try again.",
      )
    }
  }

  return (
    <>
      <Pressable
        accessibilityLabel="Define"
        accessibilityRole="button"
        onPress={() => void openDefinition()}
        style={styles.action}
        testID="selection-lookup-definition"
      >
        <BookA color={foreground} size={22} />
      </Pressable>
      {onXray && (
        <Pressable
          accessibilityLabel="X-Ray selected text"
          accessibilityRole="button"
          onPress={onXray}
          style={styles.action}
          testID="selection-lookup-xray"
        >
          <ScanSearch color={foreground} size={22} />
        </Pressable>
      )}
      {webLookups.map(({ label, provider }) => (
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          key={provider}
          onPress={() => void openWebLookup(provider)}
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
    height: SELECTION_TOOLBAR_ACTION_SIZE,
    justifyContent: "center",
    width: SELECTION_TOOLBAR_ACTION_SIZE,
  },
})
