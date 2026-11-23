import { type Kysely } from "kysely"

import { type DB } from "@/database/schema"
import { defaultPreferences } from "@/database/preferencesTypes"
import { randomUUID } from "@/uuid"

const NAMES = ["finishPrompt", "shortlist", "home"] as const

export async function up(db: Kysely<DB>): Promise<void> {
  await db
    .insertInto("preferences")
    .values(
      NAMES.map((name) => ({
        uuid: randomUUID(),
        name,
        value: JSON.stringify(defaultPreferences[name]),
      })),
    )
    .execute()
}

export async function down(db: Kysely<DB>): Promise<void> {
  await db.deleteFrom("preferences").where("name", "in", NAMES).execute()
}
