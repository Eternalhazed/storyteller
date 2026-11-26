import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as wait } from "node:timers/promises"
import { promisify } from "node:util"

import { getSetting } from "@/database/settings"
import { SCRATCH_DIR } from "@/directories"

const run = promisify(execFile)
const AUDIO_BYTES = 8 * 1024 * 1024
const MULTIPART_BYTES = AUDIO_BYTES + 16 * 1024
const AUDIO_SECONDS = 60
const SAMPLE_RATE = 16_000
const BYTES_PER_SAMPLE = 2
export const TRANSCRIPTION_TIMEOUT_MS = 90_000
const RETRY_DELAYS_MS = [300, 600, 900]
const TOTAL_RETRY_WAIT_MS = 2_000
const TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions"

type SpeechConfig = { apiKey: string; model: string }

export class SpeechError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function getSpeechConfig(): Promise<SpeechConfig | null> {
  const apiKey = (await getSetting("openRouterApiKey"))?.trim()
  return apiKey ? { apiKey, model: await getSetting("speechModel") } : null
}

export async function readSpeechUpload(request: Request, signal: AbortSignal) {
  const contentType = request.headers.get("content-type")
  if (
    !request.body ||
    !contentType?.toLowerCase().startsWith("multipart/form-data;")
  ) {
    throw new SpeechError("Send a multipart audio recording.", 400)
  }
  const tooLarge = new SpeechError(
    "The recording must be 8 MB or smaller.",
    413,
  )
  if (Number(request.headers.get("content-length")) > MULTIPART_BYTES)
    throw tooLarge
  let size = 0
  const bounded = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength
        if (size > MULTIPART_BYTES) throw tooLarge
        controller.enqueue(chunk)
      },
    }),
    { signal },
  )
  let form: FormData
  try {
    form = await new Response(bounded, {
      headers: { "content-type": contentType },
    }).formData()
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof SpeechError) throw error
    throw new SpeechError("The audio upload could not be read.", 400)
  }
  const audio = form.get("audio")
  if (typeof audio === "string" || !audio?.size) {
    throw new SpeechError("No audio recording was provided.", 400)
  }
  if (audio.size > AUDIO_BYTES) throw tooLarge
  const language = form.get("language")
  if (
    language !== null &&
    (typeof language !== "string" ||
      !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language) ||
      language.length > 35)
  ) {
    throw new SpeechError("Invalid speech language.", 400)
  }
  return { audio, language }
}

/** Decode one track, allowing a little extra output only to detect overlong audio. */
export async function speechWav(
  audio: Blob,
  signal: AbortSignal,
): Promise<Buffer> {
  await mkdir(SCRATCH_DIR, { recursive: true })
  const dir = await mkdtemp(join(SCRATCH_DIR, "dictation-"))
  try {
    const input = join(dir, "input")
    const output = join(dir, "output.wav")
    await writeFile(input, new Uint8Array(await audio.arrayBuffer()), {
      signal,
    })
    try {
      await run(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-xerror",
          "-protocol_whitelist",
          "file",
          "-format_whitelist",
          "mov,mp3,aac,wav,matroska,webm,ogg,flac",
          "-i",
          input,
          "-map",
          "0:a:0",
          "-t",
          String(AUDIO_SECONDS + 1),
          "-ar",
          String(SAMPLE_RATE),
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          "-fflags",
          "+bitexact",
          "-f",
          "wav",
          output,
        ],
        { signal, maxBuffer: 64 * 1024, windowsHide: true },
      )
    } catch (error) {
      signal.throwIfAborted()
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new SpeechError(
          "The server could not convert the recording.",
          500,
        )
      }
      throw new SpeechError("The recording format could not be read.", 422)
    }
    const wav = await readFile(output, { signal })
    // ffmpeg writes a seekable RIFF file. Measure its PCM payload rather
    // than trusting the original container's duration metadata.
    for (let offset = 12; offset + 8 <= wav.length;) {
      const size = wav.readUInt32LE(offset + 4)
      if (wav.toString("ascii", offset, offset + 4) === "data") {
        if (!size) throw new SpeechError("No audio was recorded.", 422)
        if (size > AUDIO_SECONDS * SAMPLE_RATE * BYTES_PER_SAMPLE) {
          throw new SpeechError(
            "The recording must be 60 seconds or shorter.",
            413,
          )
        }
        return wav
      }
      offset += 8 + size + (size % 2)
    }
    throw new SpeechError("No audio was recorded.", 422)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function retryAfterMs(header: string | null): number {
  if (!header) return 0
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  return Math.max(0, Date.parse(header) - Date.now()) || 0
}

export async function transcribeSpeech(
  config: SpeechConfig,
  wav: Buffer,
  language: string | null,
  signal: AbortSignal,
): Promise<string> {
  const body = JSON.stringify({
    model: config.model,
    input_audio: { data: wav.toString("base64"), format: "wav" },
    ...(language && { language }),
  })
  let waited = 0
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    const response = await fetch(TRANSCRIPTION_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal,
    }).catch(() => null)
    if (response?.ok) {
      const result: unknown = await response.json().catch(() => null)
      // An empty string is a valid answer (no speech heard): final, not retried.
      if (
        result &&
        typeof result === "object" &&
        "text" in result &&
        typeof result.text === "string"
      ) {
        return result.text.trim()
      }
    } else if (response) {
      // Do not expose upstream payloads, which could echo request data.
      await response.body?.cancel().catch(() => undefined)
      if (response.status !== 429 && response.status < 500) {
        throw new SpeechError(
          "The speech provider rejected the recording. Check the server's dictation settings.",
          502,
        )
      }
    }
    signal.throwIfAborted()
    const backoff = RETRY_DELAYS_MS[attempt]
    if (backoff === undefined) break
    const delay = Math.max(
      backoff,
      retryAfterMs(response?.headers.get("retry-after") ?? null),
    )
    if (waited + delay > TOTAL_RETRY_WAIT_MS) break
    await wait(delay, undefined, { signal })
    waited += delay
  }
  throw new SpeechError(
    "The speech provider did not return a transcription. Please try again.",
    502,
  )
}
