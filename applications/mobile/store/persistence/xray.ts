import * as FileSystem from "expo-file-system/legacy"
import { Platform } from "react-native"

import { type UUID, randomUUID } from "@/uuid"

import { getLocalBookXrayDirectoryUrl } from "./files"
import {
  type XrayCacheFiles,
  readXrayCache,
  readXrayCacheMetadata,
  writeXrayCache,
} from "./xrayCache"

function cacheFiles(bookUuid: UUID): XrayCacheFiles {
  const directory = getLocalBookXrayDirectoryUrl(bookUuid)
  return {
    read: (name) => FileSystem.readAsStringAsync(`${directory}${name}`),
    write: (name, contents) => writeAtomic(`${directory}${name}`, contents),
    remove: (name) =>
      FileSystem.deleteAsync(`${directory}${name}`, { idempotent: true }),
    newDataFile: () => `xray-${randomUUID()}.json`,
  }
}

export async function readLocalBookXray(bookUuid: UUID) {
  return readXrayCache(cacheFiles(bookUuid))
}

export async function readLocalBookXrayMetadata(bookUuid: UUID) {
  return readXrayCacheMetadata(cacheFiles(bookUuid))
}

export async function writeLocalBookXray(
  bookUuid: UUID,
  cached: { json: string; etag: string | null },
) {
  await FileSystem.makeDirectoryAsync(getLocalBookXrayDirectoryUrl(bookUuid), {
    intermediates: true,
  })
  return writeXrayCache(cacheFiles(bookUuid), cached)
}

async function writeAtomic(uri: string, contents: string) {
  // iOS writes atomically. Android needs a same-directory temporary file and
  // rename so a failed write cannot truncate the previously downloaded copy.
  if (Platform.OS === "ios") {
    await FileSystem.writeAsStringAsync(uri, contents)
    return
  }

  const temporaryUri = `${uri}.${randomUUID()}.tmp`
  try {
    await FileSystem.writeAsStringAsync(temporaryUri, contents)
    await FileSystem.moveAsync({ from: temporaryUri, to: uri })
  } finally {
    try {
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true })
    } catch {
      // Cleanup must not turn a completed refresh into a failure.
    }
  }
}
