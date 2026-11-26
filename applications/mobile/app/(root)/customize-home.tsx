import { GripVertical } from "lucide-react-native"
import { Pressable, View } from "react-native"
import ReorderableList, {
  type ReorderableListReorderEvent,
  reorderItems,
  useReorderableDrag,
} from "react-native-reorderable-list"

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
import { PAUSED_DAYS, resolveOrder } from "@/store/homeSections"
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
    description: "Books you bookmarked to read soon",
  },
  nextInSeries: {
    title: "Next in your series",
    description: "The next unread book after the furthest you've read",
  },
  forYou: { title: "For you", description: "Recommendations picked for you" },
  nearlyDone: {
    title: "Nearly done",
    description: "Books more than half read that you set aside",
  },
  startSeries: {
    title: "Start a new series",
    description: "The first book of series you haven't started",
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
    description: `Books you started but haven't opened in ${PAUSED_DAYS} days. They move here so they don't crowd your other rows.`,
  },
}

const COVER_SIZES: { value: HomePreferences["coverSize"]; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
]

function SectionRow({
  title,
  description,
  visible,
  index,
  count,
  onMove,
  onVisibilityChange,
}: {
  title: string
  description: string
  visible: boolean
  index: number
  count: number
  onMove: (event: ReorderableListReorderEvent) => void
  onVisibilityChange: (visible: boolean) => void
}) {
  const drag = useReorderableDrag()
  return (
    <View className="border-border bg-background flex-row items-center gap-3 border-b py-1">
      <Pressable
        accessible
        accessibilityLabel={title}
        accessibilityHint={description}
        accessibilityActions={[
          ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
          ...(index + 1 < count
            ? [{ name: "moveDown", label: "Move down" }]
            : []),
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "moveUp") {
            onMove({ from: index, to: index - 1 })
          } else if (nativeEvent.actionName === "moveDown") {
            onMove({ from: index, to: index + 1 })
          }
        }}
        delayLongPress={250}
        onLongPress={drag}
        className="active:bg-secondary min-h-11 min-w-0 flex-1 flex-row items-center gap-2 rounded py-2"
      >
        <Icon as={GripVertical} size={20} className="text-muted-foreground" />
        <View className="min-w-0 flex-1">
          <Text className="font-semibold">{title}</Text>
          <Text className="text-muted-foreground text-sm">{description}</Text>
        </View>
      </Pressable>
      <Switch
        accessibilityLabel={`Show ${title}`}
        checked={visible}
        onCheckedChange={onVisibilityChange}
      />
    </View>
  )
}

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

  function move({ from, to }: ReorderableListReorderEvent) {
    if (from === to || to < 0 || to >= order.length) return
    save({ ...home, order: reorderItems(order, from, to) })
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
      <View className="w-full max-w-2xl flex-1 self-center">
        <ReorderableList
          data={order}
          keyExtractor={(id) => id}
          onReorder={move}
          panActivateAfterLongPress={270}
          contentInsetAdjustmentBehavior={
            usesSystemHeader ? "automatic" : "never"
          }
          ListHeaderComponent={
            <View className="gap-2 pt-4 pb-1">
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
                    <Text numberOfLines={1}>{label}</Text>
                  </Button>
                ))}
              </View>
              <Text variant="h2" className="mt-6">
                Sections
              </Text>
              <Text className="text-muted-foreground text-sm">
                Hold and drag a section to reorder it. Use the switches to show
                or hide sections.
              </Text>
            </View>
          }
          renderItem={({ item: id, index }) => {
            const label = SECTION_LABELS[id]
            return (
              <SectionRow
                title={label?.title ?? shelfNames[id] ?? id}
                description={label?.description ?? "A shelf from the web app"}
                visible={!home.hidden.includes(id)}
                index={index}
                count={order.length}
                onMove={move}
                onVisibilityChange={(checked) => setVisible(id, checked)}
              />
            )
          }}
          ListFooterComponent={
            <View className="pt-6 pb-40">
              <Button
                variant="secondary"
                className="self-start"
                accessibilityLabel="Restore the default Home layout"
                onPress={() => save(defaultPreferences.home)}
              >
                <Text>Restore default layout</Text>
              </Button>
            </View>
          }
        />
      </View>
    </View>
  )
}
