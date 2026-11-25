import { db } from "@/database/connection"

const DAY = 86_400_000
export const cacheTtl = {
  work: 30 * DAY,
  similar: 30 * DAY,
  search: 7 * DAY,
  author: 7 * DAY,
  series: DAY,
}

// Stay below SQLite's parameter limit, including the three binds per write.
const SQL_BATCH = 250

type CacheValue<T> = { data: T | null }

export async function cachedMany<T>(
  ids: string[],
  prefix: string,
  ttl: number,
  load: (missing: string[]) => Promise<Map<string, T>>,
): Promise<Map<string, T>> {
  const result = new Map<string, T>()
  const missing: string[] = []
  const unique = [...new Set(ids)]
  const now = Date.now()

  for (let offset = 0; offset < unique.length; offset += SQL_BATCH) {
    const batch = unique.slice(offset, offset + SQL_BATCH)
    const rows = await db
      .selectFrom("catalogCache")
      .selectAll()
      .where(
        "key",
        "in",
        batch.map((id) => prefix + id),
      )
      .where("fetchedAt", ">", now - ttl)
      .execute()
    const byKey = new Map(rows.map((row) => [row.key, row]))
    for (const id of batch) {
      const row = byKey.get(prefix + id)
      if (!row) {
        missing.push(id)
        continue
      }
      const { data } = row.value as CacheValue<T>
      if (data !== null) result.set(id, data)
      else if (row.fetchedAt <= now - DAY) missing.push(id)
    }
  }

  if (!missing.length) return result
  const loaded = await load(missing)
  const fetchedAt = Date.now()
  for (let offset = 0; offset < missing.length; offset += SQL_BATCH) {
    const rows = missing.slice(offset, offset + SQL_BATCH).map((id) => {
      const data = loaded.get(id) ?? null
      if (data !== null) result.set(id, data)
      return {
        key: prefix + id,
        value: JSON.stringify({ data }),
        fetchedAt,
      }
    })
    await db
      .insertInto("catalogCache")
      .values(rows)
      .onConflict((oc) =>
        oc.column("key").doUpdateSet((eb) => ({
          value: eb.ref("excluded.value"),
          fetchedAt: eb.ref("excluded.fetchedAt"),
        })),
      )
      .execute()
  }
  return result
}

export async function cachedList<T>(
  id: string,
  prefix: string,
  ttl: number,
  load: () => Promise<T[]>,
): Promise<T[]> {
  const cached = await cachedMany([id], prefix, ttl, async () => {
    const data = await load()
    return data.length ? new Map([[id, data]]) : new Map<string, T[]>()
  })
  return cached.get(id) ?? []
}
