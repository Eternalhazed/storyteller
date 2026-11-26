import {
  type RecordingStatus,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio"
import { File } from "expo-file-system"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Platform } from "react-native"

import { requestErrorStatus } from "@/store/requestErrors"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

const RECORDING_SECONDS = 60
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
}

type Phase = "idle" | "starting" | "recording" | "stopping" | "transcribing"

function discard(uri: string) {
  try {
    if (Platform.OS === "web") {
      URL.revokeObjectURL(uri)
    } else {
      const file = new File(uri)
      if (file.exists) file.delete()
    }
  } catch {
    // The cache file may already have been removed by the recorder or OS.
  }
}

function dictationError(error: unknown): string {
  switch (requestErrorStatus(error)) {
    case 404:
      return "Dictation isn’t set up on this server. You can still type your message."
    case 413:
      return "This recording was too long or too large. Try a shorter recording."
    case 504:
    case "TIMEOUT_ERROR":
      return "Dictation timed out. Try recording again or type your message."
    default:
      return "Couldn’t transcribe the recording. Try again or type your message."
  }
}

export function useHelperDictation(
  serverUuid: UUID,
  onText: (text: string) => void,
) {
  const [transcribe] = serverApi.useTranscribeHelperAudioMutation()
  const [phase, setPhase] = useState<Phase>("idle")
  const current = useRef<Phase>("idle")
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const recordingMode = useRef(false)
  const recordingUri = useRef<string | null>(null)
  const cancelUpload = useRef<(() => void) | null>(null)

  function update(next: Phase) {
    current.current = next
    if (mounted.current) setPhase(next)
  }

  async function releaseMic() {
    if (!recordingMode.current) return
    recordingMode.current = false
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
  }

  async function finish(uri: string | null) {
    if (current.current !== "recording" && current.current !== "stopping")
      return
    update("transcribing")
    const originalUri = recordingUri.current
    recordingUri.current = null
    await releaseMic()
    if (!uri) {
      if (originalUri) discard(originalUri)
      if (mounted.current) setError("Couldn’t save the recording. Try again.")
      update("idle")
      return
    }
    try {
      if (!mounted.current) return
      const audio = new FormData()
      if (Platform.OS === "web") {
        const blob = await (await fetch(uri)).blob()
        audio.append("audio", blob, "dictation.webm")
      } else {
        // The app's fetch takes Blob parts only; expo-file-system's File is
        // one, read straight from the recorder's cache file.
        audio.append("audio", new File(uri), "dictation.m4a")
      }
      if (!mounted.current) return
      const request = transcribe({ serverUuid, audio })
      cancelUpload.current = request.abort
      const { text } = await request.unwrap()
      if (!mounted.current) return
      if (text.trim()) onText(text)
      else setError("I didn’t catch any words. Try again a little closer.")
    } catch (cause) {
      if (mounted.current) setError(dictationError(cause))
    } finally {
      cancelUpload.current = null
      discard(uri)
      update("idle")
    }
  }

  const onRecordingEvent = useEffectEvent((status: RecordingStatus) => {
    if (status.isFinished) void finish(status.hasError ? null : status.url)
  })
  const recorder = useAudioRecorder(RECORDING_OPTIONS)
  const { durationMillis } = useAudioRecorderState(recorder, 250)
  useEffect(() => {
    const subscription = recorder.addListener(
      "recordingStatusUpdate",
      (status) => {
        onRecordingEvent(status)
      },
    )
    return () => subscription.remove()
  }, [recorder])

  const cleanup = useEffectEvent(() => {
    cancelUpload.current?.()
    const uri = recordingUri.current
    recordingUri.current = null
    if (uri) {
      void Promise.resolve()
        .then(() => recorder.stop())
        .catch(() => undefined)
        .finally(() => discard(uri))
    }
    void releaseMic()
  })
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cleanup()
    }
  }, [])

  async function toggle() {
    if (current.current === "recording") {
      update("stopping")
      const uri = recorder.uri
      try {
        await recorder.stop()
        // iOS may not emit a completion event when explicitly stopped.
        if (Platform.OS === "ios") await finish(recorder.uri ?? uri)
      } catch {
        await finish(null)
      }
      return
    }
    if (current.current !== "idle") return
    update("starting")
    setError(null)
    try {
      const permission = await requestRecordingPermissionsAsync()
      if (!mounted.current) return
      if (!permission.granted) {
        setError(
          "Microphone access was denied. Allow it in settings or type your message.",
        )
        update("idle")
        return
      }
      await setAudioModeAsync({ allowsRecording: true })
      recordingMode.current = true
      if (!mounted.current) {
        await releaseMic()
        return
      }
      await recorder.prepareToRecordAsync()
      if (!mounted.current) return
      recordingUri.current = recorder.uri
      // Leave a fraction of a second for AAC framing and the Android timer.
      recorder.record({ forDuration: RECORDING_SECONDS - 0.25 })
      update("recording")
    } catch {
      const uri = recordingUri.current
      recordingUri.current = null
      if (uri) discard(uri)
      await releaseMic()
      if (mounted.current)
        setError(
          "Couldn’t start the microphone. Try again or type your message.",
        )
      update("idle")
    }
  }

  return {
    phase,
    error,
    clearError: () => setError(null),
    toggle,
    elapsed: Math.floor(durationMillis / 1000),
  }
}
