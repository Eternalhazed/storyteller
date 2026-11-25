import {
  type PickView,
  type RoundView,
} from "@storyteller/web/src/recommendations/types"
import { Image } from "expo-image"
import { Link } from "expo-router"
import { Pressable, View } from "react-native"

import { cn } from "@/lib/utils"
import {
  recommendationPickHref,
  resolvedWorkHref,
  stageLabel,
} from "@/store/recommendations"
import { type UUID } from "@/uuid"

import { Button } from "./ui/button"
import { Text } from "./ui/text"

export function RecommendationCover({
  url,
  className,
}: {
  url: string | null
  className?: string | undefined
}) {
  return (
    <View
      className={cn(
        "bg-muted aspect-[2/3] w-16 shrink-0 overflow-hidden rounded-md",
        className,
      )}
    >
      {url && (
        <Image
          source={url}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessible={false}
        />
      )}
    </View>
  )
}

export function PickBadges({ pick }: { pick: PickView }) {
  if (!pick.pill && !pick.label) return null
  return (
    <View className="flex-row flex-wrap items-center gap-1.5">
      {pick.pill && (
        <Text className="bg-secondary rounded-full px-2 py-0.5 text-xs font-medium">
          {pick.pill === "new" ? "New" : "A stretch"}
        </Text>
      )}
      {pick.label && (
        <Text className="text-muted-foreground text-xs">{pick.label}</Text>
      )}
    </View>
  )
}

export function PickCard({
  pick,
  serverUuid,
  horizontal = false,
  requestsEnabled = false,
  offline = false,
  outcome,
}: {
  pick: PickView
  serverUuid: UUID
  horizontal?: boolean
  requestsEnabled?: boolean
  offline?: boolean
  outcome?: string
}) {
  return (
    <View
      className={
        horizontal
          ? "w-32"
          : "border-border bg-card flex-row items-center gap-2 rounded-lg border p-3"
      }
    >
      <Link href={recommendationPickHref(serverUuid, pick.uuid)} asChild>
        <Pressable
          accessibilityRole="link"
          className={
            horizontal ? "gap-2" : "min-w-0 flex-1 flex-row items-center gap-3"
          }
        >
          <RecommendationCover
            url={pick.work.coverUrl}
            className={horizontal ? "w-full" : undefined}
          />
          <View className={cn("min-w-0 gap-1", !horizontal && "flex-1")}>
            <Text
              numberOfLines={horizontal ? 2 : undefined}
              className="font-semibold"
            >
              {pick.work.title}
            </Text>
            <Text
              numberOfLines={horizontal ? 1 : 2}
              className="text-muted-foreground text-sm"
            >
              {pick.reason}
            </Text>
            <PickBadges pick={pick} />
            {outcome && <Text className="text-xs font-medium">{outcome}</Text>}
          </View>
        </Pressable>
      </Link>
      {!horizontal && !outcome && requestsEnabled && (
        <Link href={resolvedWorkHref(serverUuid, pick.work, pick.uuid)} asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={offline}
            accessibilityLabel={`Get ${pick.work.title}`}
          >
            <Text>Get</Text>
          </Button>
        </Link>
      )}
    </View>
  )
}

export function RoundProgress({ round }: { round: RoundView }) {
  if (round.status === "done") return null
  return (
    <Text
      className="text-muted-foreground text-sm"
      accessibilityLiveRegion="polite"
    >
      {round.status === "running"
        ? stageLabel(round.stage)
        : (round.error ?? "Could not finish this round. Try again.")}
    </Text>
  )
}
