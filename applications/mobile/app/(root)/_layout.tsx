import { Stack } from "expo-router"
import { Platform } from "react-native"
import { useReducedMotion } from "react-native-reanimated"

import { BackButton } from "@/components/BackButton"
import { usesSystemHeader } from "@/lib/nativeChrome"
import { useRequestNotifications } from "@/pushNotifications"

/**
 * The JavaScript back button, for platforms that do not draw a system header.
 *
 * A `headerLeft` React view becomes a bar button item with a custom view, and
 * iOS leaves custom views out of the iPhone Duo rail — which pins the whole bar
 * to the top of the screen. iOS screens contribute a native item instead; see
 * `ScreenBackButton`.
 */
function javaScriptBackButton(fallback = "/") {
  return usesSystemHeader
    ? {}
    : {
        headerBackVisible: false,
        headerLeft: () => <BackButton fallback={fallback} />,
      }
}

function recommendationScreen(title: string) {
  return {
    title,
    headerShown: true,
    headerShadowVisible: false,
    ...javaScriptBackButton(),
  }
}

export default function ModalLayout() {
  const modalPresentation = Platform.OS === "android" ? "formSheet" : "modal"
  const reduceMotion = useReducedMotion()
  useRequestNotifications()

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        ...(reduceMotion ? { animation: "none" } : {}),
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen
        name="settings"
        options={{
          headerShown: true,
          headerShadowVisible: false,
          title: "Settings",
          ...javaScriptBackButton(),
        }}
      />
      <Stack.Screen
        name="customize-home"
        options={{
          headerShown: true,
          headerShadowVisible: false,
          title: "Customize home",
          ...javaScriptBackButton(),
        }}
      />
      <Stack.Screen name="read/[uuid]" options={{ gestureEnabled: false }} />
      <Stack.Screen
        name="navigation-menu"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: "fitToContents",
          sheetGrabberVisible: false,
          sheetLargestUndimmedDetentIndex: "none",
        }}
      />
      <Stack.Screen
        name="speed-menu"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: "fitToContents",
          sheetGrabberVisible: false,
          sheetLargestUndimmedDetentIndex: "none",
        }}
      />
      <Stack.Screen
        name="reading-settings"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: "fitToContents",
          sheetGrabberVisible: false,
          sheetLargestUndimmedDetentIndex: "none",
        }}
      />
      <Stack.Screen
        name="footnote"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: "fitToContents",
          sheetGrabberVisible: false,
          sheetLargestUndimmedDetentIndex: "last",
        }}
      />
      <Stack.Screen
        name="book/[uuid]"
        options={{ headerShown: usesSystemHeader, title: "" }}
      />
      <Stack.Screen name="shelf/[type]" />
      <Stack.Screen name="shortlist" />
      <Stack.Screen name="author/[uuid]" />
      <Stack.Screen name="series/index" />
      <Stack.Screen
        name="request/index"
        options={{
          headerShown: true,
          headerShadowVisible: false,
          title: "Requests",
          ...javaScriptBackButton(),
        }}
      />
      <Stack.Screen
        name="request/new"
        options={{
          headerShown: true,
          headerShadowVisible: false,
          title: "Request a book",
          ...javaScriptBackButton(),
        }}
      />
      <Stack.Screen
        name="request/[uuid]"
        options={{
          headerShown: true,
          headerShadowVisible: false,
          title: "Request details",
          ...javaScriptBackButton(),
        }}
      />
      <Stack.Screen name="ask" options={recommendationScreen("Ask")} />
      <Stack.Screen
        name="recommendations/index"
        options={recommendationScreen("Recommendations")}
      />
      <Stack.Screen
        name="recommendations/tune"
        options={recommendationScreen("Tune recommendations")}
      />
      <Stack.Screen
        name="recommendations/preferences"
        options={recommendationScreen("Recommendation preferences")}
      />
      <Stack.Screen
        name="recommendations/history"
        options={recommendationScreen("Earlier picks")}
      />
      <Stack.Screen
        name="recommendations/pick/[uuid]"
        options={recommendationScreen("Recommended book")}
      />
      <Stack.Screen
        name="server"
        options={{
          headerShown: true,
          headerShadowVisible: false,
          title: "Select server",
          ...javaScriptBackButton("/settings"),
        }}
      />
      <Stack.Screen
        name="listen/[uuid]"
        options={{
          presentation: modalPresentation,
          sheetShouldOverflowTopInset: true,
        }}
      />
      <Stack.Screen
        name="custom-theme/index"
        options={{
          presentation: modalPresentation,
          sheetShouldOverflowTopInset: true,
        }}
      />
      <Stack.Screen
        name="custom-theme/new"
        options={{
          presentation: modalPresentation,
          sheetShouldOverflowTopInset: true,
        }}
      />
      <Stack.Screen
        name="custom-theme/[name]"
        options={{
          presentation: modalPresentation,
          sheetShouldOverflowTopInset: true,
        }}
      />
      <Stack.Screen
        name="custom-fonts"
        options={{
          presentation: modalPresentation,
          sheetShouldOverflowTopInset: true,
        }}
      />
      <Stack.Screen
        name="log"
        options={{
          presentation: modalPresentation,
          sheetShouldOverflowTopInset: true,
        }}
      />
    </Stack>
  )
}
