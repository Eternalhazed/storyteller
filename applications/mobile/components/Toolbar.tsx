import { skipToken } from "@reduxjs/toolkit/query"
import { Link } from "expo-router"
import { BookOpen, Headphones, ScanSearch } from "lucide-react-native"
import { View } from "react-native"

import { type Bookmark } from "@/database/bookmarks"
import { useAppSelector } from "@/store/appState"
import { useGetBookQuery, useGetBookXrayQuery } from "@/store/localApi"
import {
  getCurrentlyPlayingBookUuid,
  getCurrentlyPlayingFormat,
} from "@/store/selectors/bookshelfSelectors"
import { canUseXray } from "@/store/xrayBoundary"

import { BookmarkItem } from "./toolbarItems/BookmarkItem"
import { LayoutItem } from "./toolbarItems/LayoutItem"
import { NavigationItem } from "./toolbarItems/NavigationItem"
import { SettingsItem } from "./toolbarItems/SettingsItem"
import { SleepTimerItem } from "./toolbarItems/SleepTimerItem"
import { SpeedItem } from "./toolbarItems/SpeedItem"
import { Button } from "./ui/button"
import { Icon } from "./ui/icon"

type Props = {
  mode: "audio" | "text"
  activeBookmarks: Bookmark[]
}

export function Toolbar({ mode, activeBookmarks }: Props) {
  const bookUuid = useAppSelector(getCurrentlyPlayingBookUuid)
  const selectedFormat = useAppSelector(getCurrentlyPlayingFormat)
  const format = selectedFormat ?? "readaloud"

  const { data: book } = useGetBookQuery(
    bookUuid ? { uuid: bookUuid } : skipToken,
  )
  const { data: xray } = useGetBookXrayQuery(
    bookUuid ? { bookUuid } : skipToken,
  )
  const hasXray = canUseXray({ xray, format, mode })
  if (!book) return null

  return (
    <>
      <View
        className={
          hasXray
            ? "min-w-0 shrink flex-row flex-wrap items-center justify-end gap-1"
            : "flex-row items-center gap-1"
        }
      >
        {mode === "text" && <LayoutItem />}
        {mode === "text" && <SettingsItem />}
        {mode === "audio" && <SleepTimerItem />}
        {mode === "text" && (
          <View className="xs:flex hidden">
            <SleepTimerItem />
          </View>
        )}
        <SpeedItem />
        <NavigationItem mode={mode} hasXray={hasXray} />
        {hasXray && (
          <Link
            asChild
            href={{
              pathname: "/navigation-menu/xray",
              params: { uuid: book.uuid, format, mode },
            }}
          >
            <Button accessibilityLabel="Open X-Ray" variant="ghost" size="icon">
              <Icon as={ScanSearch} size={24} />
            </Button>
          </Link>
        )}
        <BookmarkItem activeBookmarks={activeBookmarks} />
        {format === "readaloud" &&
          (mode === "audio" ? (
            <Link
              asChild
              replace
              href={{
                pathname: "/read/[uuid]",
                params: { uuid: book.uuid, format },
              }}
            >
              <Button
                accessibilityLabel={`Switch to reading ${book.title}`}
                variant="ghost"
                size="icon"
              >
                <Icon as={BookOpen} size={24} />
              </Button>
            </Link>
          ) : (
            <Link
              asChild
              replace
              href={{
                pathname: "/listen/[uuid]",
                params: { uuid: book.uuid, format },
              }}
            >
              <Button
                accessibilityLabel={`Switch to listening to ${book.title}`}
                variant="ghost"
                size="icon"
              >
                <Icon as={Headphones} size={24} />
              </Button>
            </Link>
          ))}
      </View>
    </>
  )
}
