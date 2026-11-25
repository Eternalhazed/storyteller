# Book requests

---

Readers can ask for a book from the Android app, approve the edition once, and
get a notification when they can read it, then another when the narration is
synced. Storyteller owns the request, decides which shelf the book goes on, and
brings the files into the library. Finding and downloading releases is done by
an **acquisition adapter**: a small service you run yourself that speaks the
HTTP contract below. Storyteller ships no adapter and names no download source.

With no adapter configured, every request control is hidden.

## Setting it up

1. Run an acquisition adapter that implements the [contract](#adapter-contract).
2. Give the adapter's download folder to Storyteller **read-only**, for example
   as a read-only bind mount. Requested books are always _copied_ into the
   library from there, so whatever seeds the download is never touched.
3. Set these environment variables:

   | Variable                              | Meaning                                                    |
   | ------------------------------------- | ---------------------------------------------------------- |
   | `STORYTELLER_ACQUISITION_URL`         | The adapter's base URL.                                    |
   | `STORYTELLER_ACQUISITION_SECRET`      | A shared secret, sent as `Authorization: Bearer <secret>`. |
   | `STORYTELLER_ACQUISITION_SECRET_FILE` | Or a file holding the secret.                              |
   | `STORYTELLER_ACQUISITION_SEED_DIR`    | Where Storyteller sees the adapter's download folder.      |

   Mount the secret file read-only and make it readable by the user the server
   runs as (UID 1000 in the Docker image), not only by root.

4. Each reader picks the shelf their requested books go on, in the app. It must
   be a private collection they belong to, so a request never puts a book where
   another reader can see it.

### Notifications

To send push notifications to the Android app, set
`STORYTELLER_PUSH_SERVICE_ACCOUNT_FILE` to the service account key of the
Firebase project the app is built with. Notifications go only to the app
installs signed in to the requesting account, and the lock screen shows that
something arrived, not what. A notification that never arrives loses nothing:
the Home card shows the same state. Like the adapter secret, the key file must
be readable by the server's user.

## What happens to a request

- The ebook and the audiobook are tracked separately, so a ready ebook can be
  read while the audiobook is still downloading.
- The book's id is reserved when the request is made. Every step can be repeated
  after a restart or a lost response without creating a second book: an import
  finds the reserved book, and a format the book already has is never replaced.
- The book is filed into the reader's request shelf only, not into collections
  named like folders on the download's path.
- A release's infohash is recorded before it is added, and the adapter is asked
  whether it is already downloading before anything is added again.
- A release with no seeders is never offered or added. Seeders are checked again
  right before adding; if they dropped to zero, the reader is asked to pick
  another version.
- A download with no new data for 30 minutes is marked stalled. It is never
  removed; the reader can pick another version and the stalled one still
  finishes if a seeder comes back.
- An audiobook copy counts as delivered only when it has as many tracks, and
  plays for as long, as the download. Tracks in disc sub-folders keep their
  folders.
- If another reader already has the same files, the book is added to your shelf
  instead: no second download, import or sync. Reading progress, statuses and
  highlights stay per reader.
- The household can add at most 10 new downloads a day. A download that is
  already present costs nothing. Both halves of a pair are counted together.
- Once both formats are in, the narration sync starts. When it is done, the
  request leaves the Home card; its history stays on the Requests screen.

## Syncing narration automatically

Under **Settings → Processing → Readaloud**, "Sync narration automatically"
queues a sync as soon as any book (requested, uploaded or dropped into an import
folder) has both an ebook and an audiobook. Each book is synced automatically at
most once: a book that was synced before, or whose sync failed, was cancelled or
is paused, is left for you to retry.

Syncs that were queued or running when the server stopped start again when it
comes back, a running one from the stage it reached. A sync that was running
through two restarts in a row is marked failed instead, so one bad book cannot
keep crashing the server.

## Adapter contract

Every call is a `POST` with a JSON body to `<STORYTELLER_ACQUISITION_URL>/v1/…`,
with `Authorization: Bearer <secret>`. Answer with JSON and a 2xx status.

### Releases

A release is one downloadable item at a source:

```json
{
  "source": "name-of-the-source",
  "id": "the-source's-own-id",
  "kind": "ebook",
  "title": "…",
  "authors": ["…"],
  "seeders": 12,
  "size": 123456,
  "infohash": "40 hex characters, or null until inspected",
  "files": [{ "path": "Book/book.epub", "size": 123456 }],
  "facts": {
    "narrators": { "value": ["…"], "source": "field" },
    "abridged": null,
    "dramatized": null,
    "language": { "value": "en", "source": "field" },
    "fileTypes": { "value": ["epub"], "source": "files" },
    "bitrateKbps": null,
    "durationSeconds": null,
    "pack": { "value": false, "source": "field" },
    "series": null,
    "publishedYear": null
  }
}
```

`kind` is `ebook` or `audio`. Each fact says where it came from: `field` for a
structured field of the source, `files` for the file list. A fact nothing
supports must be `null`; never guess one. Only a narrator from a `field` counts
as verified. `language` is a BCP 47 tag.

### Calls

| Call         | Body                                | Answer                                                                   |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `v1/search`  | `{ work, kind }`                    | `{ releases: Release[] }`                                                |
| `v1/inspect` | `{ release: { source, id, kind } }` | `{ release: Release }` with a fresh seeder count, `infohash` and `files` |
| `v1/add`     | `{ release, infohash, folder }`     | `{ infohash, alreadyPresent }`                                           |
| `v1/status`  | `{ infohashes: string[] }`          | `{ torrents: TorrentStatus[] }`                                          |

- `search`: `work` is the book the reader confirmed (`title`, `authors`,
  optional `series`, `altTitles`, `language`). List preferred sources first;
  equally good releases keep your order. Rate-limit and cache searches as your
  sources require.
- `add`: save the download into `folder` under your download root; `folder` is
  `<source>/<infohash>`. Adding one that is already present answers its infohash
  with `alreadyPresent: true`. Never remove or pause anything. Storyteller calls
  `add` again for a download it finds paused, so an `add` cut short (for
  example one that adds paused before finishing its setup) should finish the
  setup and resume when repeated.
- `status`: one entry per torrent you have, leaving out unknown hashes:

  ```json
  {
    "infohash": "…",
    "progress": 0.62,
    "bytesDone": 123456,
    "seedersConnected": 3,
    "state": "downloading",
    "folder": "name-of-the-source/<infohash>",
    "files": [{ "path": "Book/CD1/01.mp3", "size": 1234 }]
  }
  ```

  `folder` is relative to the download root, or `null` when the torrent keeps
  its files somewhere else. `files` are relative to `folder`. Paths that would
  leave the download root are refused.

## Importing from the API with the same guarantees

`POST /api/v2/books` accepts two extra fields: `bookUuid`, to create the book
with that id or attach only the formats it lacks if it exists, and
`exactCollection: true`, to file it into `collection` only. Audio files may sit
in one folder or in its disc sub-folders.
