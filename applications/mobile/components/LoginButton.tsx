import * as Linking from "expo-linking"
import { useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import { jwtDecode } from "jwt-decode"

import { type Token } from "@/apiModels"
import { saveServerSession } from "@/auth/saveServerSession"
import { logger } from "@/logger"
import { useAppDispatch } from "@/store/appState"
import { localApi } from "@/store/localApi"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

import { Button } from "./ui/button"
import { Text } from "./ui/text"

interface Props {
  serverUrl: string
  serverUuid?: UUID
  /**
   * Sign out the browser's web session first, so a different account can sign
   * in. The token replaces the one stored for `serverUuid`, keeping this
   * device's books and downloads.
   */
  switchAccount?: boolean
}

export function LoginButton({ serverUrl, serverUuid, switchAccount }: Props) {
  const router = useRouter()
  const dispatch = useAppDispatch()
  return (
    <Button
      accessibilityLabel={switchAccount ? "Switch account" : "Log in to server"}
      variant={switchAccount ? "secondary" : "default"}
      className={switchAccount ? "my-2" : ""}
      size="flex"
      onPress={async () => {
        const redirectUrl = Linking.createURL("settings")
        const tokenUrl = new URL("/api/v2/token/app", serverUrl)
        if (switchAccount) tokenUrl.searchParams.set("prompt", "login")
        const result = await WebBrowser.openAuthSessionAsync(
          tokenUrl.toString(),
          redirectUrl,
        )

        if (result.type !== "success") {
          const errorMessage = `Failed to log in: Auth session result - ${result.type}`
          logger.error(errorMessage)
          alert(errorMessage)
          return
        }

        const token = Linking.parse(result.url).queryParams?.["token"] as
          | string
          | undefined

        if (!token) {
          const errorMessage = `Failed to log in: Server did not return an auth token`
          logger.error(errorMessage)
          alert(errorMessage)
          return
        }

        const decoded = jwtDecode(token)
        const username = decoded.sub
        if (!username) {
          const errorMessage = `Failed to log in: Auth token is missing username`
          logger.error(errorMessage)
          alert(errorMessage)
          return
        }

        const response = await fetch(new URL("/api/v2/token/app", serverUrl), {
          method: "POST",
          body: JSON.stringify({ token }),
        })

        if (!response.ok) {
          const errorMessage = `Failed to log in: ${response.status} - ${await response.text()}`
          logger.error(errorMessage)
          alert(errorMessage)
          return
        }

        const sessionToken = (await response.json()) as Token

        await saveServerSession({
          serverUrl,
          sessionToken,
          username,
          ...(serverUuid ? { serverUuid } : {}),
        })

        // Cached server responses belong to the previous account.
        if (switchAccount) dispatch(serverApi.util.resetApiState())
        dispatch(localApi.util.invalidateTags(["Servers"]))

        router.replace("settings")
      }}
    >
      <Text>{switchAccount ? "Switch account" : "Login"}</Text>
    </Button>
  )
}
