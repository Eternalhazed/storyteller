/**
 * Runs the request ticker in its own process against the database in
 * STORYTELLER_DATA_DIR and kills the process the moment a scan has committed
 * an import, before the ticker can record anything about it. The parent test
 * then plays the part of the restarted server.
 *
 * Usage: tsx --conditions=@storyteller deliveryCrashChild.ts <state> <seed>
 */
import { setBooksScannedHandler } from "@/assets/library/scanner/books-scanned"
import { setEbookImportHandler } from "@/assets/library/scanner/ebook-import"
import { RequestEngine } from "@/requests/engine"

import { FileStateAdapter } from "./fakeAdapter"

const [stateFile, seedDir] = process.argv.slice(2)
if (!stateFile || !seedDir) throw new Error("usage: <state file> <seed dir>")

// The server's post-import work looks metadata up online; not part of this.
setEbookImportHandler(undefined)
setBooksScannedHandler((bookUuids) => {
  process.stdout.write(`crashed-after-import ${bookUuids.join(",")}\n`)
  process.exit(137)
})

const engine = new RequestEngine({
  adapter: new FileStateAdapter(stateFile),
  seedDir,
  notify: () => Promise.resolve(),
})

for (let pass = 0; pass < 5; pass++) await engine.tick()
process.stdout.write("finished-without-crashing\n")
