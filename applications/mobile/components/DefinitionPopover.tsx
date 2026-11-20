import * as Linking from "expo-linking"
import { ExternalLink } from "lucide-react-native"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Text } from "@/components/ui/text"
import { useColorTheme } from "@/hooks/useColorTheme"
import { logger } from "@/logger"

import { getDefinitionPopoverLayout } from "./definitionPopoverLayout"
import { buildSelectionLookupUrl } from "./selectionLookup"
import {
  type DefinitionLookup,
  lookupDefinition,
} from "./wiktionaryDefinitions"

const VISIBLE_DEFINITIONS_PER_ENTRY = 3

type Props = {
  term: string
  x: number
  y: number
  onClose: () => void
}

type LookupState =
  | { status: "loading" }
  | { status: "error" }
  | DefinitionLookup

export function DefinitionPopover({ term, x, y, onClose }: Props) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { background, foreground } = useColorTheme()
  const [attempt, setAttempt] = useState(0)
  const [lookup, setLookup] = useState<LookupState>({ status: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    setLookup({ status: "loading" })
    lookupDefinition(term, { signal: controller.signal }).then(
      setLookup,
      (error: unknown) => {
        if (controller.signal.aborted) return
        // Fetch and HTTP errors never include the request URL or term.
        logger.error(
          `Failed to load definition: ${error instanceof Error ? error.message : "unknown error"}`,
        )
        setLookup({ status: "error" })
      },
    )
    return () => controller.abort()
  }, [term, attempt])

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onClose()
        return true
      },
    )
    return () => subscription.remove()
  }, [onClose])

  const layout = getDefinitionPopoverLayout({
    bottomInset: insets.bottom,
    height,
    topInset: insets.top,
    width,
    x,
    y,
  })
  const headword = lookup.status === "found" ? lookup.term : term

  const openWiktionary = async () => {
    const result = buildSelectionLookupUrl("wiktionary", headword)
    if (!result.ok) return

    try {
      await Linking.openURL(result.url)
    } catch {
      logger.error("Failed to open wiktionary lookup")
      Alert.alert(
        "Could not open Wiktionary",
        "Check that an app or browser can open web links, then try again.",
      )
    }
  }

  return (
    <>
      <Pressable
        accessibilityLabel="Close definition"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.backdrop}
      />
      <View
        accessibilityViewIsModal
        className="border-border border"
        style={[styles.card, { backgroundColor: background }, layout]}
        testID="definition-popover"
      >
        <ScrollView
          style={styles.body}
          contentContainerClassName="px-4 pt-3 pb-2"
        >
          <Text className="text-lg font-semibold" accessibilityRole="header">
            {headword}
          </Text>
          {lookup.status === "found" && lookup.inflection && (
            <Text className="text-muted-foreground text-xs">
              {lookup.inflection.form}: {lookup.inflection.description}
            </Text>
          )}
          {lookup.status === "loading" && (
            <View className="flex-row items-center gap-2 py-3">
              <ActivityIndicator color={foreground} size="small" />
              <Text variant="muted">Looking up definition…</Text>
            </View>
          )}
          {lookup.status === "error" && (
            <View className="items-start gap-2 py-2">
              <Text className="text-sm">
                Couldn’t load a definition. Check your connection and try again.
              </Text>
              <Button
                variant="outline"
                size="sm"
                onPress={() => setAttempt((count) => count + 1)}
              >
                <Text>Try again</Text>
              </Button>
            </View>
          )}
          {lookup.status === "not-found" && (
            <Text className="py-2 text-sm">
              Wiktionary has no entry for this word.
            </Text>
          )}
          {lookup.status === "found" &&
            lookup.entries.map((entry, entryIndex) => (
              <View key={entryIndex} className="mt-2">
                <Text className="text-muted-foreground text-xs italic">
                  {entry.language && entry.language !== "English"
                    ? `${entry.language} · ${entry.partOfSpeech}`
                    : entry.partOfSpeech}
                </Text>
                {entry.definitions
                  .slice(0, VISIBLE_DEFINITIONS_PER_ENTRY)
                  .map((definition, definitionIndex) => (
                    <View key={definitionIndex} className="mt-1 flex-row">
                      <Text className="text-muted-foreground w-5 text-sm">
                        {definitionIndex + 1}.
                      </Text>
                      <Text className="flex-1 text-sm leading-5">
                        {definition}
                      </Text>
                    </View>
                  ))}
                {entry.definitions.length > VISIBLE_DEFINITIONS_PER_ENTRY && (
                  <Text className="text-muted-foreground mt-1 ml-5 text-xs">
                    {entry.definitions.length - VISIBLE_DEFINITIONS_PER_ENTRY}{" "}
                    more on Wiktionary
                  </Text>
                )}
              </View>
            ))}
        </ScrollView>
        <View className="border-border flex-row items-center justify-between border-t px-4 py-1">
          <Text className="text-muted-foreground text-xs">
            Wiktionary · CC BY-SA
          </Text>
          <Button
            accessibilityRole="link"
            variant="ghost"
            size="sm"
            onPress={() => void openWiktionary()}
          >
            <Text>
              {lookup.status === "not-found"
                ? "Search Wiktionary"
                : "Open in Wiktionary"}
            </Text>
            <Icon as={ExternalLink} size={14} />
          </Button>
        </View>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1001,
  },
  card: {
    position: "absolute",
    zIndex: 1002,
    borderRadius: 12,
    elevation: 8,
    shadowColor: "black",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
})
