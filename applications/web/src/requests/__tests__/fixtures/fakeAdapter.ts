import { readFileSync, writeFileSync } from "node:fs"

import { type AcquisitionAdapter, type ReleaseRef } from "@/requests/adapter"
import {
  type Release,
  type ReleaseFile,
  type TorrentStatus,
} from "@/requests/types"

export const SOURCE = "test-source"
export const EBOOK_HASH = "e".repeat(40)
export const AUDIO_HASH = "a".repeat(40)

const NO_FACTS: Release["facts"] = {
  narrators: null,
  abridged: null,
  dramatized: null,
  language: null,
  fileTypes: null,
  bitrateKbps: null,
  durationSeconds: null,
  pack: null,
  series: null,
  publishedYear: null,
}

export function testReleases(files: {
  ebook: ReleaseFile[]
  audio: ReleaseFile[]
}): Release[] {
  return [
    {
      source: SOURCE,
      id: "ebook-1",
      kind: "ebook",
      title: "Moby Dick",
      authors: ["Herman Melville"],
      seeders: 5,
      size: files.ebook.reduce((sum, file) => sum + file.size, 0),
      infohash: EBOOK_HASH,
      files: files.ebook,
      facts: { ...NO_FACTS, fileTypes: { value: ["epub"], source: "files" } },
    },
    {
      source: SOURCE,
      id: "audio-1",
      kind: "audio",
      title: "Moby Dick",
      authors: ["Herman Melville"],
      seeders: 7,
      size: files.audio.reduce((sum, file) => sum + file.size, 0),
      infohash: AUDIO_HASH,
      files: files.audio,
      facts: {
        ...NO_FACTS,
        narrators: { value: ["Stewart Wills"], source: "field" },
        fileTypes: { value: ["mp3"], source: "files" },
      },
    },
  ]
}

type State = {
  releases: Release[]
  /** Hashes in the download client, with the folder each was saved to. */
  added: Record<string, string>
  /** Seeder overrides by release id. */
  seeders: Record<string, number>
  calls: { add: number; inspect: number }
}

/**
 * An adapter whose download client is a JSON file, so two processes (the
 * one that crashes and the one that restarts) see the same torrents. Every
 * added torrent is complete: its files were put in the seed folder up front.
 */
export class FileStateAdapter implements AcquisitionAdapter {
  constructor(private readonly stateFile: string) {}

  static create(stateFile: string, releases: Release[]): FileStateAdapter {
    const state: State = {
      releases,
      added: {},
      seeders: {},
      calls: { add: 0, inspect: 0 },
    }
    writeFileSync(stateFile, JSON.stringify(state))
    return new FileStateAdapter(stateFile)
  }

  read(): State {
    return JSON.parse(readFileSync(this.stateFile, "utf-8")) as State
  }

  private write(state: State) {
    writeFileSync(this.stateFile, JSON.stringify(state))
  }

  setSeeders(id: string, seeders: number) {
    const state = this.read()
    state.seeders[id] = seeders
    this.write(state)
  }

  private find(state: State, ref: ReleaseRef): Release {
    const release = state.releases.find(
      (candidate) => candidate.source === ref.source && candidate.id === ref.id,
    )
    if (!release) throw new Error(`No release ${ref.id}`)
    return { ...release, seeders: state.seeders[ref.id] ?? release.seeders }
  }

  search(_work: unknown, kind: Release["kind"]): Promise<Release[]> {
    const state = this.read()
    return Promise.resolve(
      state.releases
        .filter((release) => release.kind === kind)
        .map((release) => this.find(state, release)),
    )
  }

  inspect(ref: ReleaseRef): Promise<Release> {
    const state = this.read()
    state.calls.inspect++
    this.write(state)
    return Promise.resolve(this.find(state, ref))
  }

  add(
    ref: ReleaseRef,
    infohash: string,
    folder: string,
  ): Promise<{ infohash: string; alreadyPresent: boolean }> {
    const state = this.read()
    const release = this.find(state, ref)
    if (release.infohash !== infohash) throw new Error("hash mismatch")
    const alreadyPresent = infohash in state.added
    state.added[infohash] = folder
    state.calls.add++
    this.write(state)
    return Promise.resolve({ infohash, alreadyPresent })
  }

  status(infohashes: string[]): Promise<TorrentStatus[]> {
    const state = this.read()
    return Promise.resolve(
      infohashes.flatMap((infohash) => {
        const folder = state.added[infohash]
        const release = state.releases.find((r) => r.infohash === infohash)
        if (folder === undefined || !release) return []
        const files = release.files ?? []
        return [
          {
            infohash,
            progress: 1,
            bytesDone: files.reduce((sum, file) => sum + file.size, 0),
            seedersConnected: 3,
            state: "seeding" as const,
            folder,
            files,
          },
        ]
      }),
    )
  }
}
