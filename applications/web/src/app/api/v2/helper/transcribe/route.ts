import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import {
  SpeechError,
  TRANSCRIPTION_TIMEOUT_MS,
  getSpeechConfig,
  readSpeechUpload,
  speechWav,
  transcribeSpeech,
} from "@/recommendations/helperSpeech"

export const dynamic = "force-dynamic"

/** @summary Transcribe a short Reading helper voice recording */
export const POST = withHasPermission("bookRead")(async (request) => {
  const timeout = AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS)
  const signal = AbortSignal.any([request.signal, timeout])
  try {
    const config = await getSpeechConfig()
    if (!config) {
      return NextResponse.json(
        {
          message: "Dictation is not set up on this server.",
          code: "disabled",
        },
        { status: 404 },
      )
    }
    const { audio, language } = await readSpeechUpload(request, signal)
    const wav = await speechWav(audio, signal)
    const text = await transcribeSpeech(config, wav, language, signal)
    return NextResponse.json({ text })
  } catch (error) {
    // Do not pass provider errors or user-supplied audio into an error logger.
    if (timeout.aborted) {
      return NextResponse.json(
        { message: "Dictation timed out. Please try again." },
        { status: 504 },
      )
    }
    if (error instanceof SpeechError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      )
    }
    return NextResponse.json(
      { message: "The recording could not be transcribed. Please try again." },
      { status: 500 },
    )
  }
})
