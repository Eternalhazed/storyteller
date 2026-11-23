import { Link } from "expo-router"
import { BookOpen, ChevronRight, Headphones } from "lucide-react-native"
import { Pressable, View } from "react-native"

import { type BookWithRelations } from "@/database/books"
import { type ReadingSession } from "@/store/continueReading"
import { useGetBookQuery } from "@/store/localApi"

import { AudiobookCover } from "./AudiobookCover"
import { EbookCover } from "./EbookCover"
import { Icon } from "./ui/icon"
import { Text } from "./ui/text"

export function ContinueReading({
  book,
  session,
}: {
  book: BookWithRelations
  session: ReadingSession
}) {
  const { currentData } = useGetBookQuery({ uuid: book.uuid })
  const locator = (currentData ?? book).position?.locator
  const progress = locator?.locations?.totalProgression
  const chapter = locator?.title?.trim()
  const progressLabel =
    progress !== undefined && progress >= 0 && progress <= 1
      ? `${Math.round(progress * 100)}% of book`
      : null
  const details = [chapter !== book.title ? chapter : null, progressLabel]
    .filter(Boolean)
    .join(" · ")
  const listening = session.mode === "listening"
  const action = listening ? "Continue listening" : "Continue reading"
  const params = { uuid: book.uuid, format: session.format }

  return (
    <Link
      asChild
      href={{ pathname: listening ? "/listen/[uuid]" : "/read/[uuid]", params }}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${action}: ${book.title}${details ? `, ${details}` : ""}`}
        className="border-border bg-card active:bg-secondary mr-safe-or-4 min-h-12 max-w-xl flex-row items-center gap-3 rounded-xl border p-3"
      >
        <View
          className="bg-secondary h-16 w-11 items-center justify-center overflow-hidden rounded"
          aria-hidden
        >
          <Icon
            as={listening ? Headphones : BookOpen}
            size={20}
            className="text-muted-foreground absolute"
          />
          {listening ? (
            <AudiobookCover book={book} />
          ) : (
            <EbookCover book={book} />
          )}
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-primary text-sm font-semibold">{action}</Text>
          <Text className="font-semibold" numberOfLines={2}>
            {book.title}
          </Text>
          {!!details && (
            <Text className="text-muted-foreground text-sm" numberOfLines={2}>
              {details}
            </Text>
          )}
        </View>
        <Icon as={ChevronRight} size={18} className="text-muted-foreground" />
      </Pressable>
    </Link>
  )
}
