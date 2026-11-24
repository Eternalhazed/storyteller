import { useRouter } from "expo-router"
import * as Notifications from "expo-notifications"
import * as SecureStore from "expo-secure-store"
import { useEffect } from "react"
import { Platform } from "react-native"

import { getServers } from "@/database/servers"
import { describeError } from "@/describeError"
import { logger } from "@/logger"
import { parseRequestUuid } from "@/store/requestNavigation"
import { type UUID, randomUUID } from "@/uuid"

/** Matches the channel the server names in each book request notification. */
const REQUESTS_CHANNEL = "requests"
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
  const { granted } = await Notifications.requestPermissionsAsync()
  if (!granted) return null
  try {
    const { data } = await Notifications.getDevicePushTokenAsync()
    return typeof data === "string" ? data : null
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

/** The request a tapped notification is about, if it is a book request. */
export function requestUuidOf(
  response: Notifications.NotificationResponse | null,
): UUID | undefined {
  return parseRequestUuid(
    response?.notification.request.content.data?.["requestUuid"],
  )
}

// A request notification that arrives while the app is open still shows.
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
 * Registers every signed-in server for push at start-up and whenever the
 * push token changes, and opens the request a tapped notification is about.
 * The request screen loads it as the current account, so a notification left
 * over from another account shows nothing of that account's request.
 */
export function useRequestNotifications() {
  const router = useRouter()
  useEffect(() => {
    void registerAllServersForPush()

    const open = (response: Notifications.NotificationResponse | null) => {
      const uuid = requestUuidOf(response)
      if (uuid) router.push({ pathname: "/request/[uuid]", params: { uuid } })
    }
    void Notifications.getLastNotificationResponseAsync().then(open)
    const tapped = Notifications.addNotificationResponseReceivedListener(open)
    const rotated = Notifications.addPushTokenListener(() => {
      void registerAllServersForPush()
    })
    return () => {
      tapped.remove()
      rotated.remove()
    }
  }, [router])
}
