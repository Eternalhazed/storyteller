import { Link } from "expo-router"
import { useState } from "react"
import { View } from "react-native"

import { BookGrid } from "@/components/BookGrid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useBookSearch } from "@/hooks/useBookSearch"
import { useIsFocused } from "@/hooks/useIsFocused"
import { useEnabledRecommendationServers } from "@/hooks/useRecommendations"
import { localApi } from "@/store/localApi"

export default function SearchScreen() {
  const [search, setSearch] = useState("")

  const results = useBookSearch(search)
  const { isSuccess: libraryLoaded } =
    localApi.endpoints.listBooks.useQueryState(undefined)
  const focused = useIsFocused()
  const [recommendationServer] = useEnabledRecommendationServers(focused)
  const query = search.trim()

  return (
    <BookGrid
      title="Search"
      books={results}
      refreshable={false}
      header={
        <View className="mx-safe-or-4 mb-2 gap-2">
          <Input
            accessibilityLabel="Search books"
            autoFocus
            maxFontSizeMultiplier={2}
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            returnKeyType="search"
          />
          {libraryLoaded &&
            !!query &&
            !results.length &&
            recommendationServer && (
              <Link
                href={{
                  pathname: "/ask",
                  params: {
                    serverUuid: recommendationServer.uuid,
                    text: query,
                  },
                }}
                asChild
              >
                <Button className="self-start" variant="outline" size="flex">
                  <Text className="shrink">Ask for ‘{query}’</Text>
                </Button>
              </Link>
            )}
        </View>
      }
    />
  )
}
