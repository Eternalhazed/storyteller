import {
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native"

import { type HighlightTint, highlightTints } from "@/colors"
import { useColorTheme } from "@/hooks/useColorTheme"

type Props = {
  style?: ViewStyle | undefined
  value?: HighlightTint | undefined
  onChange: (value: HighlightTint) => void
}

export function HighlightColorPicker({ style, value, onChange }: Props) {
  const { dark } = useColorTheme()
  return (
    <View style={[styles.container, style]}>
      {(
        Object.keys(
          highlightTints[dark ? "dark" : "light"],
        ) as Array<HighlightTint>
      ).map((color) => (
        <HighlightSwatch
          key={color}
          accessibilityLabel={`Highlight color ${color}`}
          color={color}
          selected={value === color}
          onPress={() => onChange(color)}
        />
      ))}
    </View>
  )
}

type HighlightSwatchProps = {
  accessibilityActions?: AccessibilityActionInfo[]
  accessibilityHint?: string
  accessibilityLabel: string
  color: HighlightTint
  selected?: boolean
  testID?: string
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void
  onLongPress?: () => void
  onPress: () => void
}

export function HighlightSwatch({
  color,
  selected = false,
  ...pressableProps
}: HighlightSwatchProps) {
  const { foreground, dark } = useColorTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      {...pressableProps}
    >
      <View
        style={[
          styles.button,
          {
            backgroundColor: highlightTints[dark ? "dark" : "light"][color],
          },
          selected && {
            borderWidth: 2,
            borderColor: foreground,
          },
        ]}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
  },
  button: {
    width: 24,
    height: 24,
    borderRadius: 12,
    margin: 8,
    borderWidth: 1,
    borderColor: "#AAA",
  },
})
