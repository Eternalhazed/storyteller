import { ArrowDown, ArrowUp } from "lucide-react-native"
import { View } from "react-native"
import { ScrollView } from "react-native-gesture-handler"

import { LoadingView } from "@/components/LoadingView"
import { ScreenBackButton } from "@/components/ScreenBackButton"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Switch } from "@/components/ui/switch"
import { Text } from "@/components/ui/text"
import {
  type HomePreferences,
  defaultPreferences,
} from "@/database/preferencesTypes"
import { useServerShelves } from "@/hooks/useServerShelves"
import { usesSystemHeader } from "@/lib/nativeChrome"
import { resolveOrder } from "@/store/homeSections"
import {
  useGetGlobalPreferencesQuery,
  useUpdateGlobalPreferenceMutation,
} from "@/store/localApi"

const SECTION_LABELS: Record<string, { title: string; description: string }> = {
  continue: {
    title: "Continue",
    description: "The book you were last reading or listening to",
  },
  jumpBackIn: {
    title: "Jump back in",
    description: "Books you opened in the last two weeks",
  },
  shortlist: {
    title: "Shortlist",
    description: "Books you flagged to read soon",
  },
  nextInSeries: {
    title: "Next in your series",
    description: "The next unread book after the furthest you've read",
  },
  nearlyDone: {
    title: "Nearly done",
    description: "Books more than half read that you set aside",
  },
  startSeries: {
    title: "Start a new series",
    description: "The first book of series you haven't started",
  },
  newReadalouds: {
    title: "New read-alongs",
    description: "Books that finished syncing in the last month",
  },
  toRead: {
    title: "To read",
    description: "Books outside a series, not started",
  },
  recentlyAdded: { title: "Recently added", description: "Newest books first" },
  magazines: { title: "Magazines", description: "Your magazines collection" },
  collections: {
    title: "Collections",
    description: "A row for each of your other collections",
  },
  paused: {
    title: "Paused",
    description: "A link to books untouched for two months",
  },
}

const COVER_SIZES: { value: HomePreferences["coverSize"]; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
]

export default function CustomizeHome() {
  const { data: preferences } = useGetGlobalPreferencesQuery()
  const [updatePreference] = useUpdateGlobalPreferenceMutation()
  const shelves = useServerShelves()

  if (!preferences) return <LoadingView />

  const home = preferences.home
  const shelfNames = Object.fromEntries(
    shelves.map((shelf) => [`shelf:${shelf.uuid}`, shelf.name]),
  )
  const order = resolveOrder(home.order, [
    ...Object.keys(SECTION_LABELS),
    ...Object.keys(shelfNames),
  ])

  function save(value: HomePreferences) {
    void updatePreference({ name: "home", value })
  }

  function move(id: string, by: -1 | 1) {
    const index = order.indexOf(id)
    const target = index + by
    if (target < 0 || target >= order.length) return
    const next = [...order]
    next.splice(index, 1)
    next.splice(target, 0, id)
    save({ ...home, order: next })
  }

  function setVisible(id: string, visible: boolean) {
    save({
      ...home,
      order,
      hidden: visible
        ? home.hidden.filter((hidden) => hidden !== id)
        : [...home.hidden, id],
    })
  }

  return (
    <View className="px-safe-or-6 flex-1">
      {/* Contributes header options, it does not render a view. */}
      <ScreenBackButton />
      <ScrollView
        className="w-full pt-4"
        contentInsetAdjustmentBehavior={
          usesSystemHeader ? "automatic" : "never"
        }
      >
        <View className="max-w-2xl gap-2">
          <Text variant="h2">Cover size</Text>
          <View className="flex-row gap-2 py-2">
            {COVER_SIZES.map(({ value, label }) => (
              <Button
                key={value}
                variant={home.coverSize === value ? "default" : "outline"}
                accessibilityLabel={`${label} covers`}
                accessibilityState={{ selected: home.coverSize === value }}
                onPress={() => save({ ...home, coverSize: value })}
              >
                <Text>{label}</Text>
              </Button>
            ))}
          </View>

          <Text variant="h2" className="mt-6">
            Sections
          </Text>
          <Text className="text-muted-foreground text-sm">
            Turn sections on or off and move them up or down. Shelves you build
            in the web app appear here too.
          </Text>
          {order.map((id, index) => {
            const label = SECTION_LABELS[id]
            const title = label?.title ?? shelfNames[id] ?? id
            const visible = !home.hidden.includes(id)
            return (
              <View
                key={id}
                className="border-border flex-row items-center gap-3 border-b py-3"
              >
                <View className="min-w-0 flex-1">
                  <Text className="font-semibold">{title}</Text>
                  <Text className="text-muted-foreground text-sm">
                    {label?.description ?? "A shelf from the web app"}
                  </Text>
                </View>
                <Button
                  variant="ghost"
                  size="icon"
                  accessibilityLabel={`Move ${title} up`}
                  disabled={index === 0}
                  onPress={() => move(id, -1)}
                >
                  <Icon as={ArrowUp} size={20} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  accessibilityLabel={`Move ${title} down`}
                  disabled={index === order.length - 1}
                  onPress={() => move(id, 1)}
                >
                  <Icon as={ArrowDown} size={20} />
                </Button>
                <Switch
                  accessibilityLabel={`Show ${title}`}
                  checked={visible}
                  onCheckedChange={(checked) => setVisible(id, checked)}
                />
              </View>
            )
          })}

          <Button
            variant="secondary"
            className="mt-6 self-start"
            accessibilityLabel="Restore the default Home layout"
            onPress={() => save(defaultPreferences.home)}
          >
            <Text>Restore default layout</Text>
          </Button>
        </View>
        <View className="h-40 w-full" />
      </ScrollView>
    </View>
  )
}
