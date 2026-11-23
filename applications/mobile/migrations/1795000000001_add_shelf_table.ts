import { type Kysely, sql } from "kysely"

/**
 * A local copy of the signed-in account's server shelves (the Shortlist and any
 * shelves built in the web app), so they work offline. `remote_uuid` is null
 * until a shelf created on this device has been saved on the server, and
 * `dirty` marks local membership changes that still need uploading.
 * `synced_book_uuids` retains the merge base for edits from other devices.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("shelf")
    .addColumn("uuid", "text", (col) => col.primaryKey().notNull())
    .addColumn("remote_uuid", "text")
    .addColumn("server_uuid", "text", (col) =>
      col.notNull().references("server.uuid").onDelete("cascade"),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("position", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("book_uuids", "text", (col) => col.notNull().defaultTo("[]"))
    .addColumn("synced_book_uuids", "text", (col) =>
      col.notNull().defaultTo("[]"),
    )
    .addColumn("dirty", "text", (col) => col.notNull().defaultTo("false"))
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("shelf").execute()
}
