import { ListChecks, ListTree } from "lucide-react-native"
import { useEffect } from "react"
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { type XrayEntityView } from "@storyteller-platform/xray/view"

import { XrayTypeBadge } from "@/components/XrayTypeBadge"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Text } from "@/components/ui/text"
import { useColorTheme } from "@/hooks/useColorTheme"
import {
  getXrayEntitySummary,
  xrayEntityTypeLabels,
} from "@/store/xrayNavigation"
import { getXraySelectionFacts } from "@/store/xraySelection"

import { getDefinitionPopoverLayout } from "./definitionPopoverLayout"

type Props = {
  entity: XrayEntityView
  x: number
  y: number
  onClose: () => void
  onAllMentions: () => void
}

export function XrayPopover({ entity, x, y, onClose, onAllMentions }: Props) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { background } = useColorTheme()
  const summary = getXrayEntitySummary(entity)
  const facts = getXraySelectionFacts(entity)
  const layout = getDefinitionPopoverLayout({
    bottomInset: insets.bottom,
    height,
    topInset: insets.top,
    width,
    x,
    y,
  })

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

  return (
    <>
      <Pressable
        accessibilityLabel="Close X-Ray card"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.backdrop}
      />
      <View
        accessibilityViewIsModal
        className="border-border border"
        style={[styles.card, { backgroundColor: background }, layout]}
        testID="xray-popover"
      >
        <ScrollView
          style={styles.body}
          contentContainerClassName="gap-3 px-4 pt-4 pb-3"
        >
          <View className="flex-row items-center gap-3">
            <XrayTypeBadge type={entity.type} />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text
                className="text-lg font-semibold"
                accessibilityRole="header"
              >
                {entity.name}
              </Text>
              <Text className="text-muted-foreground text-xs">
                {xrayEntityTypeLabels[entity.type]}
                {" · "}
                {entity.mentions.length}{" "}
                {entity.mentions.length === 1 ? "mention" : "mentions"} so far
              </Text>
            </View>
          </View>
          {summary && <Text className="text-sm leading-5">{summary}</Text>}
          {!!facts.length && (
            <View className="border-border gap-2 border-t pt-3">
              <View className="flex-row items-center gap-1.5">
                <Icon
                  as={ListChecks}
                  size={16}
                  className="text-muted-foreground"
                />
                <Text className="text-muted-foreground text-sm">Key facts</Text>
              </View>
              {facts.map((fact, index) => (
                <View
                  key={`${fact.at}:${index}`}
                  className="flex-row items-start gap-3"
                >
                  <View className="bg-muted-foreground mt-2 h-1.5 w-1.5 rounded-full" />
                  <Text className="min-w-0 flex-1 text-sm leading-5">
                    {fact.text}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
        <View className="border-border flex-row items-center justify-end border-t px-2 py-1">
          <Button
            accessibilityLabel={`All mentions of ${entity.name}`}
            className="h-11 sm:h-11"
            variant="ghost"
            size="sm"
            onPress={onAllMentions}
          >
            <Text>All mentions</Text>
            <Icon as={ListTree} size={16} />
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
