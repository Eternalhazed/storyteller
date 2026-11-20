import { XRAY_SCHEMA_VERSION, type Xray } from "@storyteller/xray/view"

export const XRAY_CACHE_METADATA_FILE = "xray.metadata.json"

export type XrayCacheMetadata = {
  etag: string | null
  schemaVersion: number
  supported: boolean
  file: string
}

export type XrayCacheFiles = {
  read: (name: string) => Promise<string>
  /** Replaces one file atomically; the metadata file commits the complete pair. */
  write: (name: string, contents: string) => Promise<void>
  remove: (name: string) => Promise<void>
  newDataFile: () => string
}

export async function readXrayCacheMetadata(
  files: XrayCacheFiles,
): Promise<XrayCacheMetadata | null> {
  try {
    const metadata = JSON.parse(
      await files.read(XRAY_CACHE_METADATA_FILE),
    ) as XrayCacheMetadata | null
    if (
      !metadata ||
      !Number.isSafeInteger(metadata.schemaVersion) ||
      typeof metadata.supported !== "boolean" ||
      (metadata.etag !== null && typeof metadata.etag !== "string") ||
      typeof metadata.file !== "string" ||
      !/^xray-[\da-f-]+\.json$/iu.test(metadata.file)
    )
      return null
    return metadata
  } catch {
    return null
  }
}

export async function readXrayCache(
  files: XrayCacheFiles,
): Promise<Xray | null> {
  const metadata = await readXrayCacheMetadata(files)
  if (!metadata || metadata.schemaVersion !== XRAY_SCHEMA_VERSION) return null
  try {
    const xray = JSON.parse(await files.read(metadata.file)) as Xray | null
    return xray?.schemaVersion === XRAY_SCHEMA_VERSION ? xray : null
  } catch {
    return null
  }
}

export async function writeXrayCache(
  files: XrayCacheFiles,
  { json, etag }: { json: string; etag: string | null },
): Promise<Xray | null> {
  const document = JSON.parse(json) as { schemaVersion?: unknown } | null
  const schemaVersion = document?.schemaVersion
  if (
    typeof schemaVersion !== "number" ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < 0
  ) {
    throw new Error("Invalid X-Ray schema version")
  }
  const previous = await readXrayCacheMetadata(files)
  const metadata: XrayCacheMetadata = {
    etag,
    schemaVersion,
    supported: schemaVersion === XRAY_SCHEMA_VERSION,
    file: files.newDataFile(),
  }
  let committed = false
  try {
    await files.write(metadata.file, json)
    // Publish the pointer only after its complete JSON exists. Interrupted
    // refreshes leave the old JSON/ETag pair intact, never a mixed generation.
    await files.write(XRAY_CACHE_METADATA_FILE, JSON.stringify(metadata))
    committed = true
  } finally {
    if (!committed) await files.remove(metadata.file).catch(() => undefined)
  }
  if (previous) await files.remove(previous.file).catch(() => undefined)
  return metadata.supported ? (document as Xray) : null
}

export type XrayTextDownloads = {
  ebook?: { downloadStatus: string } | null
  readaloud?: { downloadStatus: string } | null
}

export function shouldDeleteBookXray(
  format: "ebook" | "readaloud" | "audiobook" | undefined,
  remaining: XrayTextDownloads | null,
) {
  return (
    !format ||
    (remaining?.ebook?.downloadStatus !== "DOWNLOADED" &&
      remaining?.readaloud?.downloadStatus !== "DOWNLOADED")
  )
}
