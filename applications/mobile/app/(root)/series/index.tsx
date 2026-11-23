import { Link, Stack as RouterStack, useLocalSearchParams } from "expo-router"
import { useMemo, useState } from "react"
import {
  FlatList,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BackButton } from "@/components/BackButton"
import { BookThumbnailImage } from "@/components/BookThumbnail"
import { LoadingView } from "@/components/LoadingView"
import { MiniPlayerWidget } from "@/components/MiniPlayerWidget"
import { ScreenBackButton } from "@/components/ScreenBackButton"
import { calculateBookGridLayout } from "@/components/bookGridLayout"
import { seriesCardLabel } from "@/components/seriesLabel"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { useSeriesProgress } from "@/hooks/useSeriesProgress"
import { usesSystemHeader } from "@/lib/nativeChrome"
import { useListBooksQuery } from "@/store/localApi"
import type { SeriesState } from "@/store/seriesProgress"

const SORTS = ["Recently active", "Most ahead", "Not started", "A–Z"] as const
const FILTERS: { label: string; value: SeriesState | "all" }[] = [
  { label: "All", value: "all" },
  { label: "In progress", value: "inProgress" },
  { label: "Not started", value: "notStarted" },
  { label: "Caught up", value: "caughtUp" },
]

export default function SeriesListScreen() {
  const allSeries = useSeriesProgress()
  const { isLoading } = useListBooksQuery()
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Recently active")
  const params = useLocalSearchParams<{ filter?: string }>()
  const [filter, setFilter] = useState<SeriesState | "all">(
    FILTERS.find(({ value }) => value === params.filter)?.value ?? "all",
  )
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const availableWidth = width - insets.left - insets.right
  const grid = calculateBookGridLayout(availableWidth)
  const columns = Math.max(1, Math.floor(grid.numColumns / 2))
  const cardWidth = Math.floor(
    (availableWidth - 36 - (columns - 1) * 12) / columns,
  )
  const series = useMemo(() => {
    const selected = allSeries.filter(
      (entry) => filter === "all" || entry.state === filter,
    )
    return selected.sort((a, b) => {
      const byName = () => a.name.localeCompare(b.name)
      if (sort === "Most ahead")
        return b.ahead.length - a.ahead.length || byName()
      if (sort === "Not started") {
        return (
          Number(b.state === "notStarted") - Number(a.state === "notStarted") ||
          byName()
        )
      }
      if (sort === "A–Z") return byName()
      return b.lastActivity - a.lastActivity || byName()
    })
  }, [allSeries, filter, sort])

  if (isLoading) return <LoadingView />

  return (
    <View className={usesSystemHeader ? "flex-1" : "pt-safe flex-1"}>
      {usesSystemHeader ? (
        <>
          <RouterStack.Header style={{ shadowColor: "transparent" }} />
          <RouterStack.Title style={{ fontFamily: "YoungSerif" }}>
            Series
          </RouterStack.Title>
          <ScreenBackButton />
        </>
      ) : (
        <View className="px-safe-or-2 flex-row items-center gap-2">
          <BackButton />
          <Text
            className="font-youngserif my-2 font-normal tracking-normal"
            variant="h3"
          >
            Series
          </Text>
        </View>
      )}
      <FlatList
        key={columns}
        data={series}
        numColumns={columns}
        keyExtractor={(entry) => entry.uuid}
        contentContainerStyle={{
          paddingLeft: insets.left + 18,
          paddingRight: insets.right + 18,
          paddingBottom: 160,
          gap: 12,
        }}
        columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
        contentInsetAdjustmentBehavior={
          usesSystemHeader ? "automatic" : "never"
        }
        ListHeaderComponent={
          <View className="gap-3 py-3">
            <Text className="text-muted-foreground text-sm">
              {allSeries.length} series
            </Text>
            <View className="gap-2">
              <Text className="text-muted-foreground text-sm">Sort by</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {SORTS.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={sort === option ? "default" : "outline"}
                    accessibilityLabel={`Sort series: ${option}`}
                    accessibilityState={{ selected: sort === option }}
                    onPress={() => setSort(option)}
                  >
                    <Text>{option}</Text>
                  </Button>
                ))}
              </ScrollView>
            </View>
            <View className="gap-2">
              <Text className="text-muted-foreground text-sm">Show</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {FILTERS.map(({ label, value }) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={filter === value ? "default" : "outline"}
                    accessibilityLabel={`Show series: ${label}`}
                    accessibilityState={{ selected: filter === value }}
                    onPress={() => setFilter(value)}
                  >
                    <Text>{label}</Text>
                  </Button>
                ))}
              </ScrollView>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text className="text-muted-foreground py-8">
            {allSeries.length
              ? "No series match this filter."
              : "Books with series will appear here."}
          </Text>
        }
        renderItem={({ item }) => {
          const cover = item.next ?? item.books[0]
          return (
            <Link
              href={{ pathname: "/series/[uuid]", params: { uuid: item.uuid } }}
              asChild
            >
              <Pressable
                accessibilityRole="link"
                className="border-border bg-card active:bg-secondary flex-row items-start gap-3 rounded-lg border p-3"
                style={{ width: cardWidth }}
                accessibilityLabel={`${item.name}, ${item.owned} books, ${seriesCardLabel(item)}`}
              >
                {cover && (
                  <BookThumbnailImage
                    book={cover}
                    width={58}
                    height={88}
                    showActions={false}
                  />
                )}
                <View className="min-w-0 flex-1 gap-1">
                  <Text numberOfLines={2} className="text-base font-semibold">
                    {item.name}
                  </Text>
                  <Text className="text-muted-foreground text-sm">
                    {item.owned} {item.owned === 1 ? "book" : "books"} owned
                  </Text>
                  <Text className="text-primary text-sm font-semibold">
                    {seriesCardLabel(item)}
                  </Text>
                </View>
              </Pressable>
            </Link>
          )
        }}
      />
      <MiniPlayerWidget />
    </View>
  )
}
