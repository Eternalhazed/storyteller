import * as SecureStore from "expo-secure-store"

import { type Token } from "@/apiModels"
import { createServer, getServerByUrl, updateServer } from "@/database/servers"
import { registerForPush } from "@/pushNotifications"
import { type UUID, randomUUID } from "@/uuid"

type Props = {
  serverUrl: string
  sessionToken: Token
  username: string
  serverUuid?: UUID
}

export async function saveServerSession({
  serverUrl,
  sessionToken,
  username,
  serverUuid,
}: Props) {
  let uuid!: UUID
  if (!serverUuid) {
    const existingServer = await getServerByUrl(serverUrl)
    uuid =
      existingServer?.uuid ??
      (
        await createServer({
          uuid: randomUUID(),
          baseUrl: serverUrl,
        })
      ).uuid
  } else {
    uuid = serverUuid
  }

  await SecureStore.setItemAsync(
    `server.${uuid}.token`,
    sessionToken.access_token,
    { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK },
  )

  await updateServer(uuid, { username })

  // Signing in, or switching accounts, moves this install's notifications
  // to the account now signed in.
  void registerForPush({ uuid, baseUrl: serverUrl })

  return uuid
}
