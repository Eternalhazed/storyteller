import { ListTree } from "lucide-react-native"
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
          contentContainerClassName="gap-2 px-4 pt-3 pb-3"
        >
          <Text className="text-lg font-semibold" accessibilityRole="header">
            {entity.name}
          </Text>
          <Text className="text-muted-foreground text-xs">
            {xrayEntityTypeLabels[entity.type]}
          </Text>
          {summary && <Text className="text-sm">{summary}</Text>}
          {!!facts.length && (
            <View className="gap-2 pt-1">
              <Text className="text-sm font-bold">Key facts</Text>
              {facts.map((fact, index) => (
                <Text key={`${fact.at}:${index}`} className="text-sm leading-5">
                  {fact.text}
                </Text>
              ))}
            </View>
          )}
        </ScrollView>
        <View className="border-border flex-row items-center justify-between gap-2 border-t px-4 py-1">
          <Text className="text-muted-foreground min-w-0 flex-1 text-xs">
            {entity.mentions.length} mentions so far
          </Text>
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
