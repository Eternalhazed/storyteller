import { router, useGlobalSearchParams } from "expo-router"
import { View } from "react-native"

import { Highlights } from "@/components/toolbarItems/navigation/Highlights"
import { type UUID } from "@/uuid"

type NavigationMenuParams = {
  uuid?: UUID
  format?: "readaloud" | "ebook" | "audiobook"
  mode?: "text" | "audio"
}

export default function HighlightsScreen() {
  const { uuid, format, mode } = useGlobalSearchParams<NavigationMenuParams>()

  return (
    <View className="bg-background flex-1">
      <Highlights
        bookUuid={uuid}
        format={format}
        surface={mode}
        onClose={() => router.dismiss()}
      />
    </View>
  )
}
