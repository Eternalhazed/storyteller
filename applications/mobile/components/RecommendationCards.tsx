import {
  type PickView,
  type RoundView,
} from "@storyteller/web/src/recommendations/types"
import { Image } from "expo-image"
import { Link } from "expo-router"
import { ActivityIndicator, Pressable, View } from "react-native"

import { useColorTheme } from "@/hooks/useColorTheme"
import { cn } from "@/lib/utils"
import {
  ROUND_PROGRESS_STEPS,
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
  const { foreground } = useColorTheme()
  if (round.status === "done") return null
  const failed = round.status === "failed"
  return (
    <View
      className={cn(
        "bg-card w-full max-w-lg items-center gap-3 self-center rounded-xl border p-4 sm:p-6",
        failed ? "border-destructive/50" : "border-primary/40",
      )}
    >
      {failed ? (
        <>
          <Text variant="h4" className="text-destructive text-center">
            Couldn’t finish your picks
          </Text>
          <Text className="text-center" accessibilityLiveRegion="polite">
            {round.error ?? "Something went wrong while finding your books."}
          </Text>
          <Text className="text-muted-foreground text-center text-sm">
            Try again when you’re ready.
          </Text>
        </>
      ) : (
        <>
          <View className="bg-primary/10 size-14 items-center justify-center rounded-full">
            <ActivityIndicator
              size="large"
              color={foreground}
              accessible={false}
            />
          </View>
          <Text
            variant="h4"
            className="text-center"
            accessibilityLiveRegion="polite"
          >
            {stageLabel(round.stage)}
          </Text>
          <View className="w-full flex-row gap-2">
            {ROUND_PROGRESS_STEPS.map(({ stage, title }) => {
              const current = round.stage === stage
              return (
                <View key={title} className="min-w-0 flex-1 gap-1.5">
                  <View
                    className={cn(
                      "h-1 rounded-full",
                      current ? "bg-primary" : "bg-muted",
                    )}
                  />
                  <Text
                    className={cn(
                      "text-center text-xs leading-tight",
                      current
                        ? "text-primary font-bold"
                        : "text-muted-foreground",
                    )}
                    accessibilityState={{ selected: current }}
                  >
                    {title}
                  </Text>
                </View>
              )
            })}
          </View>
          <Text className="text-muted-foreground text-center text-sm">
            Usually under a minute
          </Text>
        </>
      )}
    </View>
  )
}
