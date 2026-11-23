import AsyncStorage from "@react-native-async-storage/async-storage"
import { useFocusEffect } from "expo-router"
import { useCallback, useState } from "react"

import { logger } from "@/logger"
import { type ReadingSession } from "@/store/continueReading"

const STORAGE_KEY = "storyteller.last-reading-session"

/** Record only a visible, ready reader or player, not a details-screen visit. */
export function useRememberReadingSession(session: ReadingSession | null) {
  const value = session && JSON.stringify(session)
  useFocusEffect(
    useCallback(() => {
      if (!value) return
      void AsyncStorage.setItem(STORAGE_KEY, value).catch(() => {
        logger.error("Could not remember the last reading session")
      })
    }, [value]),
  )
}

export function useLastReadingSession() {
  const [session, setSession] = useState<ReadingSession | null | undefined>()

  useFocusEffect(
    useCallback(() => {
      let focused = true
      void AsyncStorage.getItem(STORAGE_KEY)
        .then((value) => {
          if (focused) {
            setSession(value ? (JSON.parse(value) as ReadingSession) : null)
          }
        })
        .catch(() => {
          logger.error("Could not read the last reading session")
          if (focused) setSession(null)
        })
      return () => {
        focused = false
      }
    }, []),
  )

  return session
}
