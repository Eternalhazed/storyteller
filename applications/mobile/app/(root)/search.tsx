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

  return (
    <BookGrid
      title="Search"
      books={results}
      refreshable={false}
      header={
        <Input
          className="mx-safe-or-4 mb-2 w-auto"
          accessibilityLabel="Search books"
          autoFocus
          maxFontSizeMultiplier={2}
          value={search}
          onChangeText={setSearch}
          placeholder="Search"
          returnKeyType="search"
        />
      }
    />
  )
}
