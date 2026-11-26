import { setTimeout as wait } from "node:timers/promises"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  readSpeechUpload,
  transcribeSpeech,
} from "@/recommendations/helperSpeech"

vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}))

const config = { apiKey: "test-key", model: "microsoft/mai-transcribe-2" }
const wav = Buffer.from("wave data")

function transcribe(signal = new AbortController().signal) {
  return transcribeSpeech(config, wav, "en", signal)
}

function delays() {
  return vi.mocked(wait).mock.calls.map(([ms]) => ms)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("dictation provider retry policy", () => {
  it("retries transport failures, rate limits, and missing text before returning text", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("no response"))
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "0.7" } }),
      )
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ text: "  A new series  " }))
    vi.stubGlobal("fetch", fetch)
    await expect(transcribe()).resolves.toBe("A new series")
    expect(delays()).toEqual([300, 700, 900])
    expect(fetch).toHaveBeenLastCalledWith(
      "https://openrouter.ai/api/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          input_audio: { data: wav.toString("base64"), format: "wav" },
          language: "en",
        }),
      }),
    )
  })

  it("returns an empty transcript (no speech heard) without retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ text: "  " }))
    vi.stubGlobal("fetch", fetch)
    await expect(transcribe()).resolves.toBe("")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("makes at most three retries on 5xx", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    vi.stubGlobal("fetch", fetch)
    await expect(transcribe()).rejects.toMatchObject({ status: 502 })
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(delays()).toEqual([300, 600, 900])
  })

  it("stops rather than retrying ahead of Retry-After outside the wait budget", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "2" } }),
      )
    vi.stubGlobal("fetch", fetch)
    await expect(transcribe()).rejects.toMatchObject({ status: 502 })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(delays()).toEqual([300])
  })

  it("treats other 4xx as final without exposing the response body", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("private upstream diagnostic", { status: 401 }),
      )
    vi.stubGlobal("fetch", fetch)
    await expect(transcribe()).rejects.toThrow(
      "Check the server's dictation settings",
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(delays()).toEqual([])
  })

  it("honors cancellation before retrying a transport error", async () => {
    const controller = new AbortController()
    const fetch = vi.fn(() => {
      controller.abort()
      return Promise.reject(new TypeError("no response"))
    })
    vi.stubGlobal("fetch", fetch)
    await expect(transcribe(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(delays()).toEqual([])
  })
})

describe("dictation upload", () => {
  it("reads a multipart audio and optional language", async () => {
    const body = new FormData()
    body.append(
      "audio",
      new File(["recording"], "voice.m4a", { type: "audio/mp4" }),
    )
    body.append("language", "en-US")
    const request = new Request("http://localhost", { method: "POST", body })
    const { audio, language } = await readSpeechUpload(
      request,
      new AbortController().signal,
    )
    expect(language).toBe("en-US")
    expect(await audio.text()).toBe("recording")
  })

  it("rejects an oversized body without relying on Content-Length", async () => {
    const body = new FormData()
    body.append(
      "audio",
      new Blob([new Uint8Array(9 * 1024 * 1024)]),
      "voice.m4a",
    )
    const request = new Request("http://localhost", { method: "POST", body })
    await expect(
      readSpeechUpload(request, new AbortController().signal),
    ).rejects.toMatchObject({ status: 413 })
  })
})
