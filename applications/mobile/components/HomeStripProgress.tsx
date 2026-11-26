import { View } from "react-native"

export function HomeStripProgress({
  label,
  percent,
}: {
  label: string
  percent: number
}) {
  const value = Math.min(100, Math.max(0, percent))
  return (
    <View
      className="bg-secondary h-1 overflow-hidden rounded-full"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}
    >
      <View
        className="bg-primary h-full rounded-full"
        style={{ width: `${value}%` }}
      />
    </View>
  )
}
