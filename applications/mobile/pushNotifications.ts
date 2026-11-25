import { router } from "expo-router"
import * as Notifications from "expo-notifications"
import * as SecureStore from "expo-secure-store"
import { useEffect } from "react"
import { Platform } from "react-native"

import { getServers } from "@/database/servers"
import { describeError } from "@/describeError"
import { logger } from "@/logger"
import { pushDestination } from "@/store/pushRouting"
import { type UUID, randomUUID } from "@/uuid"

/** Matches the channel the server names in each book request notification. */
const REQUESTS_CHANNEL = "requests"
const RECOMMENDATIONS_CHANNEL = "recommendations"
const INSTALL_ID_KEY = "push.installId"

/**
 * One id per install of the app. The server binds it to the account the app
 * is signed in to, so a switched account stops getting the last one's
 * notifications.
 */
async function getInstallId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY)
  if (existing) return existing
  const created = randomUUID()
  await SecureStore.setItemAsync(INSTALL_ID_KEY, created)
  return created
}

/** The push token last fetched or reported, to tell a real rotation apart. */
let knownPushToken: string | null = null

/**
 * The push token for this install, after asking for permission, or null
 * when push is unavailable: the build has no push configuration, the reader
 * said no, or the platform is not Android.
 */
async function getPushToken(): Promise<string | null> {
  if (Platform.OS !== "android") return null
  await Notifications.setNotificationChannelAsync(REQUESTS_CHANNEL, {
    name: "Book requests",
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  })
  await Notifications.setNotificationChannelAsync(RECOMMENDATIONS_CHANNEL, {
    name: "New books in your series",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  })
  const { granted } = await Notifications.requestPermissionsAsync()
  if (!granted) return null
  try {
    const { data } = await Notifications.getDevicePushTokenAsync()
    if (typeof data !== "string") return null
    knownPushToken = data
    return data
  } catch (error) {
    logger.info(
      `Push notifications are unavailable in this build: ${describeError(error)}`,
    )
    return null
  }
}

async function accessToken(serverUuid: UUID) {
  return await SecureStore.getItemAsync(`server.${serverUuid}.token`)
}

/**
 * Tell one server which install this is and where to push to. Called after
 * signing in or switching accounts, and for every server at start-up so a
 * rotated token reaches them. Never throws.
 */
export async function registerForPush(server: {
  uuid: UUID
  baseUrl: string
}): Promise<void> {
  try {
    const token = await accessToken(server.uuid)
    if (!token) return
    const pushToken = await getPushToken()
    if (!pushToken) return
    const response = await fetch(new URL("/api/v2/devices", server.baseUrl), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        installId: await getInstallId(),
        platform: "android",
        pushToken,
      }),
    })
    // older servers have no device endpoint; nothing to register with
    if (!response.ok && response.status !== 404) {
      logger.warn(`Push registration failed with ${response.status}`)
    }
  } catch (error) {
    logger.warn(`Push registration failed: ${describeError(error)}`)
  }
}

/** Stop a server pushing to this install; call before forgetting its token. */
export async function unregisterFromPush(server: {
  uuid: UUID
  baseUrl: string
}): Promise<void> {
  try {
    const token = await accessToken(server.uuid)
    const installId = await SecureStore.getItemAsync(INSTALL_ID_KEY)
    if (!token || !installId) return
    await fetch(
      new URL(
        `/api/v2/devices/${encodeURIComponent(installId)}`,
        server.baseUrl,
      ),
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    )
  } catch (error) {
    logger.warn(`Push unregistration failed: ${describeError(error)}`)
  }
}

export async function registerAllServersForPush(): Promise<void> {
  const servers = await getServers()
  for (const server of servers) {
    if (server.username) await registerForPush(server)
  }
}

// A notification that arrives while the app is open still shows.
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
})

/**
 * Both destinations recheck visibility as the current signed-in account.
 * With no server identifier in the payload, they use the first signed-in server.
 */
function openTappedNotification(
  response: Notifications.NotificationResponse | null,
) {
  const destination = pushDestination(
    response?.notification.request.content.data,
  )
  if (!destination) return
  // The last response outlives the tap; clear it so it opens once.
  Notifications.clearLastNotificationResponse()
  router.push(destination)
}

/**
 * Registers every signed-in server for push at start-up and whenever the
 * push token changes, and opens the target a tapped notification is about.
 */
export function useRequestNotifications() {
  useEffect(() => {
    void registerAllServersForPush()
    void Notifications.getLastNotificationResponseAsync().then(
      openTappedNotification,
    )
    const tapped = Notifications.addNotificationResponseReceivedListener(
      openTappedNotification,
    )
    // Fetching the token reports it to this listener too, so only a token
    // that differs from the last one is a rotation worth registering.
    const rotated = Notifications.addPushTokenListener(({ data }) => {
      if (typeof data !== "string" || data === knownPushToken) return
      knownPushToken = data
      void registerAllServersForPush()
    })
    return () => {
      tapped.remove()
      rotated.remove()
    }
  }, [])
}
