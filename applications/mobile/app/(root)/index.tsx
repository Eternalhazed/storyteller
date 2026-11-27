import * as DocumentPicker from "expo-document-picker"
import { Link, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import {
  ChevronRight,
  EllipsisVertical,
  Library,
  Sparkles,
} from "lucide-react-native"
import { useEffect, useMemo, useRef } from "react"
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native"

import { ContinueReading } from "@/components/ContinueReading"
import { HomeRecommendations } from "@/components/HomeRecommendations"
import { HomeRequests } from "@/components/HomeRequests"
import { LooksFinishedCard } from "@/components/LooksFinishedCard"
import { MiniPlayerWidget } from "@/components/MiniPlayerWidget"
import { Shelf } from "@/components/Shelf"
import { Group } from "@/components/ui/Group"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Menu } from "@/components/ui/menu"
import { Text } from "@/components/ui/text"
import { type BookWithRelations } from "@/database/books"
import { type Collection } from "@/database/collections"
import { defaultPreferences } from "@/database/preferencesTypes"
import { useHomeSeriesInputs } from "@/hooks/useHomeSeriesInputs"
import { useIsFocused } from "@/hooks/useIsFocused"
import { useListAllServerBooks } from "@/hooks/useListAllServerBooks"
import { useLastReadingSession } from "@/hooks/useReadingSession"
import { useEnabledRecommendationServers } from "@/hooks/useRecommendations"
import { useServerShelves } from "@/hooks/useServerShelves"
import { useShortlist } from "@/hooks/useShortlist"
import { bookImported } from "@/store/actions"
import { useAppDispatch } from "@/store/appState"
import { getContinueReading } from "@/store/continueReading"
import { buildHomeSections } from "@/store/homeSections"
import {
  useGetGlobalPreferencesQuery,
  useListBooksQuery as useListLocalBooksQuery,
  useListCollectionsQuery,
} from "@/store/localApi"
import { recommendationsHref } from "@/store/recommendations"

const EMPTY_BOOKS: BookWithRelations[] = []
const EMPTY_COLLECTIONS: Collection[] = []

async function pickBookFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/epub+zip", "application/epub"],
    copyToCacheDirectory: true,
  })

  if (result.canceled || !result.assets[0]) return null

  return result.assets[0].uri
}

export default function Home() {
  const router = useRouter()
  const dispatch = useAppDispatch()

  const { isLoading, refetch } = useListAllServerBooks()
  const { data: liveBooks = EMPTY_BOOKS } = useListLocalBooksQuery()
  const { data: collections = EMPTY_COLLECTIONS } = useListCollectionsQuery()
  const { data: preferences } = useGetGlobalPreferencesQuery()
  const home = preferences?.home ?? defaultPreferences.home

  const staleBooksRef = useRef<BookWithRelations[]>(liveBooks)

  const isFocused = useIsFocused()
  const recommendationServers = useEnabledRecommendationServers(isFocused)
  const recommendationServer = recommendationServers[0]
  const { width, fontScale } = useWindowDimensions()
  const labelWidth = width / Math.max(fontScale, 1)
  const books = isFocused ? liveBooks : staleBooksRef.current

  useEffect(() => {
    if (isFocused) {
      staleBooksRef.current = liveBooks
    }
  }, [isFocused, liveBooks])

  const lastReadingSession = useLastReadingSession()
  const continueReading = useMemo(
    () =>
      lastReadingSession === undefined
        ? null
        : getContinueReading(books, lastReadingSession),
    [books, lastReadingSession],
  )

  const { bookUuids: shortlist } = useShortlist()
  const shelves = useServerShelves()
  const { seriesNext, seriesStarts, coverLabel } = useHomeSeriesInputs(books)

  const sections = useMemo(
    () =>
      buildHomeSections({
        books,
        now: Date.now(),
        continueBookUuid: continueReading?.book.uuid ?? null,
        shortlist,
        seriesNext,
        seriesStarts,
        shelves,
        collections,
        order: home.order,
        hidden: home.hidden,
        dedupe: true,
      }),
    [
      books,
      continueReading,
      shortlist,
      seriesNext,
      seriesStarts,
      shelves,
      collections,
      home.order,
      home.hidden,
    ],
  )

  const scrollViewRef = useRef<ScrollViewInstance>(null)

  return (
    <View className="pt-safe flex-1 items-center gap-2 bg-transparent">
      <StatusBar verticalBarBehaviorIOS="disabled" />
      <Group className="pr-safe-or-2 pl-safe-or-4 w-full items-center gap-1.5">
        <TouchableOpacity
          accessibilityLabel="Scroll to top"
          accessibilityRole="button"
          onPress={() => {
            scrollViewRef.current?.scrollTo({ y: 0, animated: true })
          }}
        >
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require("../../assets/Storyteller_Logo.png")}
            className="h-10 w-10"
          />
        </TouchableOpacity>
        <Link href="/search" asChild>
          <Pressable
            className="min-w-0 flex-1"
            accessibilityRole="link"
            accessibilityLabel="Search books"
          >
            <Input
              className="min-h-8 text-sm opacity-100"
              editable={false}
              focusable={false}
              pointerEvents="none"
              placeholder="Search"
            />
          </Pressable>
        </Link>
        <Link href="/series" asChild>
          <Button
            variant="ghost"
            size={labelWidth >= 520 ? "sm" : "icon"}
            accessibilityLabel="Series"
          >
            <Icon as={Library} size={22} className="text-primary" />
            {labelWidth >= 520 && (
              <Text numberOfLines={1} className="text-primary">
                Series
              </Text>
            )}
          </Button>
        </Link>
        {recommendationServer && (
          <Link href={recommendationsHref(recommendationServer.uuid)} asChild>
            <Button
              variant="ghost"
              size={labelWidth >= 360 ? "sm" : "icon"}
              accessibilityLabel="Discover"
            >
              <Icon as={Sparkles} size={22} className="text-primary" />
              {labelWidth >= 360 && (
                <Text numberOfLines={1} className="text-primary">
                  Discover
                </Text>
              )}
            </Button>
          </Link>
        )}
        <Menu
          actions={[
            {
              id: "customize-home",
              title: "Customize home",
              onPress: () => router.push("/customize-home"),
            },
            ...recommendationServers.map((server) => ({
              id: `recommendations:${server.uuid}`,
              title:
                recommendationServers.length > 1
                  ? `Recommendations · ${server.name ?? server.baseUrl}`
                  : "Recommendations",
              onPress: () => router.push(recommendationsHref(server.uuid)),
            })),
            {
              id: "import-book",
              title: "Import book",
              onPress: async () => {
                const uri = await pickBookFile()
                if (uri) dispatch(bookImported({ url: uri, from: "home" }))
              },
            },
            {
              id: "settings",
              title: "Settings",
              onPress: () => router.push("/settings"),
            },
          ]}
        >
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel="Open home menu"
          >
            <Icon as={EllipsisVertical} size={24} className="text-primary" />
          </Button>
        </Menu>
      </Group>
      <ScrollView
        className="pl-safe-or-6 pr-safe w-full"
        contentContainerClassName="gap-6"
        ref={scrollViewRef}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => {
              refetch()
            }}
          />
        }
      >
        <HomeRequests focused={isFocused} />
        {sections.map((section) => {
          if (section.id === "forYou") {
            return recommendationServers.map((server) => (
              <HomeRecommendations
                key={server.uuid}
                serverUuid={server.uuid}
                serverName={
                  recommendationServers.length > 1
                    ? (server.name ?? server.baseUrl)
                    : undefined
                }
                focused={isFocused}
              />
            ))
          }
          if (section.id === "continue") {
            return continueReading && section.items.length ? (
              <View key="continue" className="gap-6">
                <ContinueReading
                  {...continueReading}
                  seriesLabel={coverLabel(continueReading.book)}
                />
                <LooksFinishedCard />
              </View>
            ) : (
              <LooksFinishedCard key="continue" />
            )
          }
          if (section.id === "paused") {
            if (!section.items.length || !section.viewAll) return null
            const viewAll = section.viewAll
            return (
              <Pressable
                key="paused"
                accessibilityRole="link"
                accessibilityLabel={`Paused books, ${section.items.length}`}
                onPress={() => router.push(viewAll)}
                className="border-border mr-safe-or-4 flex-row items-center gap-2 self-start rounded-full border px-4 py-2"
              >
                <Text className="text-muted-foreground">
                  Paused · {section.items.length}
                </Text>
                <Icon
                  as={ChevronRight}
                  size={16}
                  className="text-muted-foreground"
                />
              </Pressable>
            )
          }
          return (
            <Shelf
              key={section.id}
              label={section.title}
              items={section.items}
              coverSize={home.coverSize}
              href={section.viewAll ?? undefined}
              emptyMessage={
                section.id === "shortlist" && books.length > 0
                  ? "Bookmark books to save them here."
                  : undefined
              }
            />
          )
        })}
        {books.length === 0 && (
          <View className="bg-border mr-5 gap-4 rounded p-4">
            <Text>You don’t have any books available, yet!</Text>
            <Text>
              You can{" "}
              <Link href="/server">
                <Text className="text-link">
                  connect to a Storyteller instance
                </Text>
              </Link>{" "}
              to download some.
            </Text>
          </View>
        )}
        {/* Spacer for the miniplayer */}
        <View className="h-40 w-full" />
      </ScrollView>
      <MiniPlayerWidget />
    </View>
  )
}
