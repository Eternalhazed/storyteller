import { ArrowDown, type LucideIcon } from "lucide-react-native"
import { useDeferredValue } from "react"
import { View, type ViewStyle } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"

import { useColorTheme } from "@/hooks/useColorTheme"
import { cn } from "@/lib/utils"

import { Icon } from "./ui/icon"

type Props = {
  className?: string | undefined
  accessibilityLabel?: string
  progress: number
  size: number
  style: ViewStyle
  icon?: LucideIcon
}

export function DownloadingIndicator({
  className,
  accessibilityLabel = "Progress",
  progress,
  size,
  style,
  icon: IconComponent = ArrowDown,
}: Props) {
  const { foreground, background } = useColorTheme()
  const normalizedProgress = Number.isFinite(progress)
    ? Math.max(0, Math.min(100, Math.round(progress)))
    : 0
  const deferredProgress = useDeferredValue(normalizedProgress)

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: normalizedProgress }}
      className={cn("bg-background rounded-full p-[1px]", className)}
      style={[
        {
          width: size + 2,
          height: size + 2,
        },
        style,
      ]}
    >
      <AnimatedCircularProgress
        size={size}
        width={1}
        fill={deferredProgress}
        rotation={0}
        tintColor={foreground}
        backgroundColor={background}
      >
        {() => <Icon as={IconComponent} size={size * 0.8} color={foreground} />}
      </AnimatedCircularProgress>
    </View>
  )
}
