import {
  type LucideIcon,
  MapPin,
  Package,
  User,
  Users,
} from "lucide-react-native"
import { View } from "react-native"

import { type XrayEntityView } from "@storyteller/xray/view"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

export const xrayEntityTypeIcons: Record<XrayEntityView["type"], LucideIcon> = {
  character: User,
  place: MapPin,
  group: Users,
  thing: Package,
}

/** An entry's type as a glyph on a quiet disc; the caller's label names it. */
export function XrayTypeBadge({
  type,
  size = "row",
}: {
  type: XrayEntityView["type"]
  size?: "row" | "header"
}) {
  return (
    <View
      className={cn(
        "bg-secondary items-center justify-center rounded-full",
        size === "header" ? "h-12 w-12" : "h-9 w-9",
      )}
    >
      <Icon
        as={xrayEntityTypeIcons[type]}
        size={size === "header" ? 22 : 18}
        className="text-muted-foreground"
      />
    </View>
  )
}
