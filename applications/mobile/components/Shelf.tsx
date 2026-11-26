import { type HrefObject, useRouter } from "expo-router"
import { TouchableOpacity, View, useWindowDimensions } from "react-native"
import { FlatList } from "react-native-gesture-handler"

import { type BookWithRelations } from "@/database/books"
import { type HomePreferences } from "@/database/preferencesTypes"

import { BookThumbnail } from "./BookThumbnail"
import { Stack } from "./ui/Stack"
import { Text } from "./ui/text"

const BASE_COVER_WIDTH: Record<HomePreferences["coverSize"], number> = {
  small: 104,
  medium: 124,
  large: 156,
}

/** Shelf cover width for a size preference, a little larger on tablets. */
export function shelfCoverWidth(
  size: HomePreferences["coverSize"],
  screenWidth: number,
) {
  const scale = screenWidth >= 1000 ? 1.25 : screenWidth >= 700 ? 1.1 : 1
  return Math.round(BASE_COVER_WIDTH[size] * scale)
}

export type ShelfItem = { book: BookWithRelations; reason?: string | null }

interface Props {
  label: string
  href?: string | HrefObject | undefined
  /** Books, or books with the one-line reason they're shown. */
  items: readonly ShelfItem[]
  coverSize?: HomePreferences["coverSize"]
  /** The full count for "View all", when the row shows fewer. */
  total?: number
  emptyMessage?: string | undefined
}

export function Shelf({
  label,
  href,
  items,
  coverSize = "medium",
  total,
  emptyMessage,
}: Props) {
  const router = useRouter()
  const { width } = useWindowDimensions()

  if (!items.length && !emptyMessage) return null

  const coverWidth = shelfCoverWidth(coverSize, width)

  return (
    <Stack>
      <View className="flex-row items-baseline justify-between gap-3 pr-3">
        {/* YoungSerif has a single weight, and Android measures negative
            letter spacing too narrow; either cuts or wraps the heading. */}
        <Text
          variant="h3"
          numberOfLines={1}
          className="font-youngserif min-w-0 flex-1 font-normal tracking-normal"
        >
          {label}
        </Text>

        {href && (
          <TouchableOpacity
            accessibilityLabel={`View all ${label} books`}
            accessibilityRole="button"
            onPress={() => router.push(href)}
            className="flex-row items-center"
          >
            <Text className="text-primary text-sm">
              View all ({total ?? items.length})
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {items.length > 0 ? (
        <FlatList
          horizontal
          data={items.slice(0, 25)}
          keyExtractor={({ book }) => book.uuid}
          contentContainerClassName="gap-4"
          renderItem={({ item: { book, reason } }) => (
            <BookThumbnail book={book} width={coverWidth} caption={reason} />
          )}
        />
      ) : (
        <Text className="text-muted-foreground mr-6 text-sm">
          {emptyMessage}
        </Text>
      )}
    </Stack>
  )
}
