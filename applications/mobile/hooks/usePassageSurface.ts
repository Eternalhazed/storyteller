import { useFocusEffect } from "expo-router"
import { useCallback, useEffect } from "react"

import { passageSurfaceEntered } from "@/store/actions"
import { useAppDispatch, useAppSelector } from "@/store/appState"
import {
  type PassageContext,
  passageSlice,
  samePassageContext,
} from "@/store/slices/passageSlice"

export function usePassageNavigation(context: PassageContext) {
  return useAppSelector((state) => {
    const navigation = state.passage.navigation
    return navigation && samePassageContext(navigation.context, context)
      ? navigation
      : null
  })
}

export function useClosePassageOnUnmount({
  bookUuid,
  format,
  surface,
}: PassageContext) {
  const dispatch = useAppDispatch()
  useFocusEffect(
    useCallback(() => {
      dispatch(passageSurfaceEntered({ bookUuid, format, surface }))
    }, [bookUuid, dispatch, format, surface]),
  )
  useEffect(
    () => () => {
      dispatch(
        passageSlice.actions.command({ bookUuid, format, surface }, "leave"),
      )
    },
    [bookUuid, dispatch, format, surface],
  )
}
