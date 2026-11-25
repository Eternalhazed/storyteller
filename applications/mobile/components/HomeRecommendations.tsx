import { Link } from "expo-router"
import { Pressable, ScrollView, View } from "react-native"

import { useRecommendationFeed } from "@/hooks/useRecommendations"
import { recommendationsHref } from "@/store/recommendations"
import { type UUID } from "@/uuid"

import { PickCard } from "./RecommendationCards"
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
  if (!feed?.forYou.length) return null
  return (
    <View className="gap-2">
      <View className="mr-safe-or-4 flex-row items-baseline justify-between gap-3">
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
            <Text className="text-primary text-sm">See all</Text>
          </Pressable>
        </Link>
      </View>
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
    </View>
  )
}
