import { LegendList } from "@legendapp/list/react-native"
import { Stack as RouterStack } from "expo-router"
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react-native"
import { useMemo, useState } from "react"
import {
  Alert,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { withUniwind } from "uniwind"

import { BackButton } from "@/components/BackButton"
import { BookThumbnail } from "@/components/BookThumbnail"
import { MiniPlayerWidget } from "@/components/MiniPlayerWidget"
import { ScreenBackButton } from "@/components/ScreenBackButton"
import { calculateBookGridLayout } from "@/components/bookGridLayout"
import { Stack } from "@/components/ui/Stack"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Text } from "@/components/ui/text"
import { type BookWithRelations } from "@/database/books"
import { useListAllServerBooks } from "@/hooks/useListAllServerBooks"
import { useShortlist } from "@/hooks/useShortlist"
import { usesSystemHeader } from "@/lib/nativeChrome"
import { cn } from "@/lib/utils"
import { useListBooksQuery, useListShelvesQuery } from "@/store/localApi"
import { getShortlists } from "@/store/shortlist"
import { type UUID } from "@/uuid"

const ShortlistGrid = withUniwind(LegendList<BookWithRelations>)

export default function ShortlistScreen() {
  const [editing, setEditing] = useState(false)
  const { bookUuids, move, remove } = useShortlist()
  const { data: allBooks, isLoading: loadingBooks } = useListBooksQuery()
  const {
    data: shelves,
    isLoading: loadingShelves,
    isError,
    refetch: refreshShelves,
  } = useListShelvesQuery()
  const { isLoading: refreshing, refetch } = useListAllServerBooks()
  const dimensions = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { numColumns, thumbnailWidth } = calculateBookGridLayout(
    dimensions.width - insets.left - insets.right,
  )
  const books = useMemo(() => {
    const byUuid = new Map(allBooks?.map((book) => [book.uuid, book]))
    return bookUuids.flatMap((uuid) => {
      const book = byUuid.get(uuid)
      return book ? [book] : []
    })
  }, [allBooks, bookUuids])
  const positions = useMemo(() => {
    const result = new Map<UUID, { index: number; count: number }>()
    for (const shelf of getShortlists(shelves ?? [])) {
      shelf.bookUuids.forEach((uuid, index) => {
        result.set(uuid, { index, count: shelf.bookUuids.length })
      })
    }
    return result
  }, [shelves])
  const update = (operation: Promise<void>) => {
    void operation.catch(() => {
      Alert.alert("Could not update Shortlist", "Please try again.")
    })
  }

  return (
    <>
      {usesSystemHeader && (
        <>
          <RouterStack.Header style={{ shadowColor: "transparent" }} />
          <RouterStack.Title style={{ fontFamily: "YoungSerif" }}>
            Shortlist
          </RouterStack.Title>
          <ScreenBackButton />
        </>
      )}
      <Stack
        className={cn("flex-1 items-stretch", !usesSystemHeader && "pt-safe")}
      >
        {!usesSystemHeader && (
          <View className="px-safe-or-2 w-full flex-row items-center gap-2">
            <BackButton />
            <Text className="font-youngserif my-2" variant="h3">
              Shortlist
            </Text>
          </View>
        )}
        <ShortlistGrid
          key={numColumns}
          className="flex-1"
          contentContainerClassName="px-safe-or-3"
          data={books}
          numColumns={numColumns}
          keyExtractor={(book) => book.uuid}
          recycleItems
          drawDistance={dimensions.height}
          extraData={{ editing, positions }}
          renderScrollComponent={(props) => (
            <ScrollView
              {...props}
              contentInsetAdjustmentBehavior={
                usesSystemHeader ? "automatic" : "never"
              }
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                refetch()
                void refreshShelves()
              }}
            />
          }
          ListHeaderComponent={
            <View className="gap-3 px-1.5 pb-3">
              <View className="flex-row flex-wrap items-center justify-between gap-3">
                <Text className="text-muted-foreground">
                  {books.length} books
                </Text>
                <Button
                  variant="outline"
                  size="flex"
                  className="min-h-11"
                  disabled={!editing && books.length === 0}
                  accessibilityState={{ selected: editing }}
                  onPress={() => setEditing((value) => !value)}
                >
                  <Text>{editing ? "Done" : "Edit order"}</Text>
                </Button>
              </View>
              {editing && (
                <Text className="text-muted-foreground text-sm">
                  Move books up or down, or remove them.
                </Text>
              )}
              {isError && (
                <Text className="text-destructive">
                  Could not load your Shortlist. Pull to try again.
                </Text>
              )}
            </View>
          }
          ListEmptyComponent={
            <View className="gap-2 px-4 py-8">
              <Text variant="h4">
                {loadingBooks || loadingShelves
                  ? "Loading Shortlist…"
                  : "Your Shortlist is empty"}
              </Text>
              {!loadingBooks && !loadingShelves && (
                <Text className="text-muted-foreground">
                  Tap the flag on a book to keep it here for later.
                </Text>
              )}
            </View>
          }
          renderItem={({ item: book }) => {
            const position = positions.get(book.uuid)
            return (
              <View
                className="mx-1.5 my-2 gap-3"
                style={{ width: thumbnailWidth }}
              >
                <BookThumbnail book={book} width={thumbnailWidth} />
                {editing && (
                  <View className="gap-2">
                    <Button
                      variant="outline"
                      size="flex"
                      className="min-h-11"
                      disabled={!position || position.index === 0}
                      accessibilityLabel={`Move ${book.title} up`}
                      onPress={() => update(move(book.uuid, "up"))}
                    >
                      <Icon as={ArrowUp} size={18} />
                      <Text>Move up</Text>
                    </Button>
                    <Button
                      variant="outline"
                      size="flex"
                      className="min-h-11"
                      disabled={
                        !position || position.index === position.count - 1
                      }
                      accessibilityLabel={`Move ${book.title} down`}
                      onPress={() => update(move(book.uuid, "down"))}
                    >
                      <Icon as={ArrowDown} size={18} />
                      <Text>Move down</Text>
                    </Button>
                    <Button
                      variant="outline"
                      size="flex"
                      className="min-h-11"
                      accessibilityLabel={`Remove ${book.title} from Shortlist`}
                      onPress={() => update(remove(book.uuid))}
                    >
                      <Icon as={Trash2} size={18} />
                      <Text>Remove</Text>
                    </Button>
                  </View>
                )}
              </View>
            )
          }}
          ListFooterComponent={<View className="h-40 w-full" />}
        />
        <MiniPlayerWidget />
      </Stack>
    </>
  )
}
