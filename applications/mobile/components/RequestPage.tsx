import { type ReactNode } from "react"
import { ScrollView, View } from "react-native"

import { usesSystemHeader } from "@/lib/nativeChrome"

import { ScreenBackButton } from "./ScreenBackButton"
import { Text } from "./ui/text"

export function RequestPage({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1">
      <ScreenBackButton />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-safe-or-4 pb-safe-or-8 items-center pt-4"
        contentInsetAdjustmentBehavior={
          usesSystemHeader ? "automatic" : "never"
        }
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-2xl gap-4">{children}</View>
      </ScrollView>
    </View>
  )
}

export function RequestError({ children }: { children: ReactNode }) {
  return (
    <Text className="text-destructive text-sm" accessibilityLiveRegion="polite">
      {children}
    </Text>
  )
}

export function OtherRequestAccount() {
  return (
    <RequestPage>
      <Text>This request belongs to another account.</Text>
    </RequestPage>
  )
}
