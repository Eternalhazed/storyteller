import { Link } from "expo-router"
import { Sparkles } from "lucide-react-native"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"

import { useColorTheme } from "@/hooks/useColorTheme"
import { useRecommendationFeed } from "@/hooks/useRecommendations"
import { recommendationsHref, stageLabel } from "@/store/recommendations"
import { type UUID } from "@/uuid"

import { PickCard } from "./RecommendationCards"
import { Icon } from "./ui/icon"
import { Text } from "./ui/text"

export function HomeRecommendations({
  serverUuid,
  serverName,
  focused,
}: {
  serverUuid: UUID
  serverName?: string | undefined
  focused: boolean
}) {
  const { feed } = useRecommendationFeed(serverUuid, focused)
  const { foreground } = useColorTheme()
  if (!feed) return null
  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between gap-3 pr-3">
        <View className="min-w-0 flex-1">
          {/* Same heading as the other Home rows (see Shelf). */}
          <Text
            variant="h3"
            className="font-youngserif shrink font-normal tracking-normal"
          >
            For you
          </Text>
          {serverName && (
            <Text numberOfLines={1} className="text-muted-foreground text-sm">
              {serverName}
            </Text>
          )}
        </View>
        <Link href={recommendationsHref(serverUuid)} asChild>
          <Pressable accessibilityRole="button" hitSlop={8}>
            <Text className="text-primary text-sm">View all</Text>
          </Pressable>
        </Link>
      </View>
      <Link href={{ pathname: "/ask", params: { serverUuid } }} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask the reading helper"
          className="border-border bg-card mr-3 flex-row items-center gap-3 rounded-full border px-4 py-3"
        >
          <Icon as={Sparkles} size={20} className="text-primary" />
          <Text numberOfLines={1} className="text-muted-foreground flex-1">
            Ask the reading helper what to read next…
          </Text>
        </Pressable>
      </Link>
      {feed.running && (
        <View className="bg-muted mr-3 flex-row items-center gap-2 self-start rounded-md px-3 py-2">
          <ActivityIndicator
            size="small"
            color={foreground}
            accessible={false}
          />
          <Text
            className="text-sm font-medium"
            accessibilityLiveRegion="polite"
          >
            {stageLabel(feed.running.stage)}
          </Text>
        </View>
      )}
      {!!feed.forYou.length && (
        <ScrollView
          horizontal
          contentContainerClassName="pr-safe-or-4 gap-3"
          showsHorizontalScrollIndicator={false}
        >
          {feed.forYou.map((pick) => (
            <PickCard
              key={pick.uuid}
              pick={pick}
              serverUuid={serverUuid}
              horizontal
            />
          ))}
        </ScrollView>
      )}
    </View>
  )
}
