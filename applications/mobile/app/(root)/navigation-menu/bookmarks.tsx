import { router, useGlobalSearchParams } from "expo-router"
import { View } from "react-native"

import { Bookmarks } from "@/components/toolbarItems/navigation/Bookmarks"
import { type UUID } from "@/uuid"

type NavigationMenuParams = {
  uuid?: UUID
  format?: "readaloud" | "ebook" | "audiobook"
  mode?: "text" | "audio"
}

export default function BookmarksScreen() {
  const { uuid, format, mode } = useGlobalSearchParams<NavigationMenuParams>()

  return (
    <View className="bg-background flex-1">
      <Bookmarks
        bookUuid={uuid}
        format={format}
        surface={mode}
        onClose={() => router.dismiss()}
      />
    </View>
  )
}
