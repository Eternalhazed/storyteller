import { router, useGlobalSearchParams } from "expo-router"
import { View } from "react-native"

import { XRay } from "@/components/toolbarItems/navigation/XRay"
import { type UUID } from "@/uuid"

type NavigationMenuParams = {
  uuid?: UUID
  format?: "readaloud" | "ebook" | "audiobook"
  mode?: "text" | "audio"
  entityId?: string
  selectionBoundary?: string
}

export default function XrayScreen() {
  const { uuid, format, mode, entityId, selectionBoundary } =
    useGlobalSearchParams<NavigationMenuParams>()
  const requestedEntity = Number(entityId)
  const requestedBoundary = Number(selectionBoundary)

  return (
    <View className="bg-background flex-1">
      <XRay
        key={`${uuid}:${entityId ?? ""}:${selectionBoundary ?? ""}`}
        bookUuid={uuid}
        format={format}
        mode={mode}
        initialEntityId={
          Number.isSafeInteger(requestedEntity) && requestedEntity >= 0
            ? requestedEntity
            : undefined
        }
        selectionBoundary={
          Number.isSafeInteger(requestedBoundary) && requestedBoundary >= 0
            ? requestedBoundary
            : undefined
        }
        onClose={() => router.dismiss()}
      />
    </View>
  )
}
