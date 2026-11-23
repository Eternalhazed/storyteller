import { Flag } from "lucide-react-native"
import { Alert } from "react-native"

import { type BookWithRelations } from "@/database/books"
import { canShortlist, useShortlist } from "@/hooks/useShortlist"

import { Button } from "./ui/button"
import { Icon } from "./ui/icon"
import { Text } from "./ui/text"

export function ShortlistToggle({
  book,
  variant = "button",
}: {
  book: BookWithRelations
  variant?: "button" | "icon"
}) {
  const { isShortlisted, toggle } = useShortlist()
  if (!canShortlist(book)) return null
  const selected = isShortlisted(book.uuid)
  return (
    <Button
      variant={selected ? "secondary" : "outline"}
      size={variant === "icon" ? "icon" : "flex"}
      className={variant === "icon" ? "min-h-11 min-w-11" : "min-h-11"}
      accessibilityLabel={
        selected ? "Remove from Shortlist" : "Add to Shortlist"
      }
      accessibilityState={{ selected }}
      onPress={() => {
        void toggle(book.uuid).catch(() => {
          Alert.alert("Could not update Shortlist", "Please try again.")
        })
      }}
    >
      <Icon as={Flag} size={20} fill={selected ? "currentColor" : "none"} />
      {variant === "button" && (
        <Text>{selected ? "On Shortlist" : "Shortlist"}</Text>
      )}
    </Button>
  )
}
