import { Undo2Icon } from "lucide-react-native"
import { View } from "react-native"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Text } from "@/components/ui/text"
import { useAppDispatch, useAppSelector } from "@/store/appState"
import {
  type PassageContext,
  isMoving,
  passageSlice,
  samePassageContext,
} from "@/store/slices/passageSlice"

type Props = PassageContext & {
  placement: "reader" | "player" | "menu"
  onContinue?: () => void
}

export function NavigationReturnControl({
  bookUuid,
  format,
  surface,
  placement,
  onContinue,
}: Props) {
  const dispatch = useAppDispatch()
  const context = { bookUuid, format, surface }
  const nav = useAppSelector((state) => {
    const active = state.passage.navigation
    return active && samePassageContext(active.context, context) ? active : null
  })

  if (!nav || (placement === "menu" && (!nav.preview || nav.move))) return null
  const busy = isMoving(nav.move)
  const failed = nav.move?.state === "failed"
  const remote = !!nav.remote && !nav.preview && !busy

  return (
    <View className="bg-background border-border max-w-full self-end rounded-lg border px-1">
      {placement === "menu" ? (
        <Button
          className="h-auto min-h-12"
          variant="ghost"
          onPress={() => {
            dispatch(passageSlice.actions.command(context, "continue"))
            onContinue?.()
          }}
        >
          <Text className="text-sm font-semibold">Continue here</Text>
        </Button>
      ) : (
        <>
          {busy ? (
            <Text
              accessibilityLiveRegion="polite"
              className="px-3 py-3 text-sm"
            >
              {nav.move?.purpose === "continue"
                ? "Saving your place…"
                : "Moving to passage…"}
            </Text>
          ) : (
            <>
              {failed && (
                <View className="px-3 pt-2">
                  <Text accessibilityLiveRegion="polite" className="text-sm">
                    Couldn’t open or save that passage.
                  </Text>
                  <Button
                    variant="ghost"
                    className="h-auto min-h-12"
                    onPress={() =>
                      dispatch(passageSlice.actions.command(context, "retry"))
                    }
                  >
                    <Text>Try again</Text>
                  </Button>
                </View>
              )}
              {remote && (
                <View className="px-2">
                  <Text
                    accessibilityLiveRegion="polite"
                    className="px-1 pt-2 text-sm"
                  >
                    Other device has a newer position.
                  </Text>
                  <View className="flex-row flex-wrap">
                    <Button
                      variant="ghost"
                      className="h-auto min-h-12"
                      onPress={() =>
                        dispatch(
                          passageSlice.actions.command(context, "remote"),
                        )
                      }
                    >
                      <Text>Use synced position</Text>
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-auto min-h-12"
                      onPress={() =>
                        dispatch(passageSlice.actions.command(context, "keep"))
                      }
                    >
                      <Text>Stay here</Text>
                    </Button>
                  </View>
                </View>
              )}
              {!remote && (
                <Button
                  accessibilityLabel="Back to where I was"
                  variant="ghost"
                  className="h-auto min-h-12 max-w-full px-3"
                  onPress={() =>
                    dispatch(passageSlice.actions.command(context, "return"))
                  }
                >
                  <Icon as={Undo2Icon} size={18} />
                  <Text className="flex-shrink text-sm font-semibold">
                    Back to where I was
                  </Text>
                </Button>
              )}
              {nav.preview && surface === "audio" && !failed && (
                <Text className="text-muted-foreground px-3 pb-2 text-xs">
                  Playback paused for preview
                </Text>
              )}
            </>
          )}
        </>
      )}
    </View>
  )
}
