import { Buffer } from "node:buffer"

import { describe, expect, it } from "vitest"
import { ZipFile } from "yazl"

import { parseCsv } from "@/history/csv"
import { matchedKindleStatus, parseKindle } from "@/history/kindle"
import { parseAudible, parseGoodreads } from "@/history/parsers"

const now = new Date("2025-09-30T00:00:00Z")

async function zip(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const archive = new ZipFile()
  for (const [name, contents] of Object.entries(entries)) {
    archive.addBuffer(
      typeof contents === "string" ? Buffer.from(contents) : contents,
      name,
    )
  }
  archive.end()
  const chunks: Buffer[] = []
  for await (const chunk of archive.outputStream as AsyncIterable<Buffer>)
    chunks.push(chunk)
  return Buffer.concat(chunks)
}

describe("Goodreads library CSV", () => {
  it("reads RFC 4180 quoting, BOM, multiline reviews, and spreadsheet-formatted ISBNs", () => {
    const input =
      "\uFEFFBook Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Exclusive Shelf,Read Count,My Review\r\n" +
      '400,"Songs of the ""Tide"" (Illustrated) (Harbor Tales, #2)",R. Writer,"Writer, R.","S. Writer, T. Writer","=""0385340028""","=""9780385340024""",5,320,1956,2024/05/17,2024/01/20,"favorites, at-sea",read,2,"first line\r\nsecond line"\r\n' +
      '401,New Start,,"Writer, J.",,="",="",0,,,,2024/02/20,,currently-reading,0,\r\n' +
      "402,Still Waiting,A. Writer,,,,,0,,,,,,to-read,0,\r\n" +
      '403,Did Not Finish,B. Writer,,,,,0,,,,,"favorite, did-not-finish",to-read,0,\r\n'
    const books = parseGoodreads(input)
    expect(books[0]).toMatchObject({
      sourceId: "400",
      title: 'Songs of the "Tide" (Illustrated)',
      series: { name: "Harbor Tales", position: 2 },
      authors: ["R. Writer", "S. Writer", "T. Writer"],
      isbn10: "0385340028",
      isbn13: "9780385340024",
      rating: 5,
      pages: 320,
      publishedYear: 1956,
      finishedAt: "2024-05-17T00:00:00.000Z",
      addedAt: "2024-01-20T00:00:00.000Z",
      readCount: 2,
      status: "read",
      explicit: true,
      shelves: ["favorites", "at-sea"],
    })
    expect(books[1]).toMatchObject({
      authors: ["Writer, J."],
      isbn10: null,
      rating: null,
      status: "reading",
      explicit: true,
    })
    expect(books[2]).toMatchObject({ status: "to_read", explicit: true })
    expect(books[3]).toMatchObject({ status: "abandoned", explicit: true })
  })

  it("preserves terminal empty fields and rejects broken quoting or the wrong schema", () => {
    expect([...parseCsv('"a","b",\r\nc,d,')]).toEqual([
      ["a", "b", ""],
      ["c", "d", ""],
    ])
    expect(() => [...parseCsv('"unfinished')]).toThrow(/unclosed/)
    expect(() => [...parseCsv('"a"C,D')]).toThrow(/unexpected text/)
    expect(() => parseGoodreads("id,title\r\n77,Wrong File")).toThrow(
      /Goodreads/,
    )
  })
})

describe("Audible CLI JSON", () => {
  it("distinguishes explicit completion, derived progress, stale listening, and ownership", () => {
    const base = {
      title: "The Coast",
      authors: "S. Writer, L. Writer",
      narrators: "N. Voice, R. Voice",
      purchase_date: "2025-01-02T00:00:00Z",
    }
    const books = parseAudible(
      JSON.stringify([
        {
          ...base,
          asin: "B000000001",
          is_finished: true,
          percent_complete: 4,
          series_title: "Harbor Tales",
          series_sequence: "1.5",
          runtime_length_min: 275,
        },
        {
          ...base,
          asin: "B000000002",
          is_finished: false,
          percent_complete: "97",
        },
        {
          ...base,
          asin: "B000000003",
          percent_complete: 96,
          last_listened_at: "2025-09-28T00:00:00Z",
          authors: [{ name: "S. Writer" }],
        },
        { ...base, asin: "B000000004", percent_complete: 8 },
        { ...base, asin: "B000000005", percent_complete: 0 },
      ]),
      now,
    )
    expect(books[0]).toMatchObject({
      sourceId: "B000000001",
      title: "The Coast",
      authors: ["S. Writer", "L. Writer"],
      narrators: ["N. Voice", "R. Voice"],
      series: { name: "Harbor Tales", position: 1.5 },
      runtimeMinutes: 275,
      addedAt: "2025-01-02T00:00:00.000Z",
      progress: 1,
    })
    expect(books.map(({ status, explicit }) => [status, explicit])).toEqual([
      ["read", true],
      ["read", false],
      ["reading", false],
      ["abandoned", false],
      ["owned_unread", false],
    ])
    expect(books[2]?.authors).toEqual(["S. Writer"])
    expect(() => parseAudible('{"error":"Not a library"}', now)).toThrow(
      /list of books/,
    )
  })
})

describe("Amazon Kindle data ZIP", () => {
  it("joins ownership and per-device sessions, ignores unrelated datasets and falls back to reading insights", async () => {
    const session =
      "\uFEFFstart_timestamp,end_timestamp,ASIN,purchased_marketplace,preferred_marketplace,device_family,device_serial_number,device_software_version,content_type,total_reading_millis,number_of_page_flips\r\n"
    const read =
      "2025-09-25T14:00:00Z,2025-09-25T15:00:00Z,B000000003,,,,,,EBOK,3600000,84\r\n"
    const docs = await zip({
      "Kindle.KindleDocs/datasets/Kindle.KindleDocs.DocumentMetadata/Kindle.KindleDocs.DocumentMetadata.csv":
        "DocumentId,Title,Authors\r\nB000000001,Old Read,S. Writer\r\nB000000003,A Long Read,S. Writer\r\n",
    })
    const bytes = await zip({
      "Kindle/Kindle.Devices.ReadingSession/Kindle.Devices.ReadingSession.csv":
        session +
        read +
        read +
        "2025-01-03T14:00:00Z,2025-01-03T14:10:00Z,B000000001,,,,,,EBOK,600000,2\r\n" +
        "2025-09-29T14:00:00Z,2025-09-29T14:10:00Z,B000000099,,,,,,EBOK,600000,2\r\n",
      "Kindle/Kindle.KindleDocs.zip": docs,
      "Kindle/Digital.SeriesContent.Relation.2/BookRelation.csv":
        "ASIN,Product Name,Creation Date\r\nB000000002,Never Opened,2025-01-01\r\nB000000004,Insights Only,2025-01-01\r\nB000000099,Not Available,2025-01-01\r\n",
      "Kindle/Kindle.ReadingInsights/datasets/Kindle.reading-insights-sessions_with_adjustments/Kindle.reading-insights-sessions_with_adjustments.csv":
        "ASIN,start_time,end_time,total_reading_milliseconds\nB000000004,2025-09-29T16:00:00Z,2025-09-29T16:03:00Z,180000\nB000000003,2025-09-25T14:00:00Z,2025-09-25T15:00:00Z,3600000\n",
      "Retail.Orders.1/Orders.csv":
        'ASIN,Title\nB000000066,"intentionally malformed',
      "Personal.Information.zip": "not a zip",
      "Kindle/Unrelated/Searches.csv": "ASIN,Title\nB000000098,Not A Book\n",
    })
    const books = await parseKindle(bytes, now)
    expect(books).toHaveLength(4)
    expect(books.find(({ asin }) => asin === "B000000001")).toMatchObject({
      status: "abandoned",
      readingMinutes: 10,
      pageFlips: 2,
    })
    expect(books.find(({ asin }) => asin === "B000000002")).toMatchObject({
      title: "Never Opened",
      status: "owned_unread",
      readingMinutes: null,
      addedAt: "2025-01-01T00:00:00.000Z",
    })
    expect(books.find(({ asin }) => asin === "B000000003")).toMatchObject({
      status: "reading",
      readingMinutes: 60,
      pageFlips: 84,
    })
    expect(books.find(({ asin }) => asin === "B000000004")).toMatchObject({
      status: "reading",
      readingMinutes: 3,
    })
    expect(books.every(({ explicit }) => !explicit)).toBe(true)
  })

  it("only infers a soft completed read once known length clears either threshold", () => {
    const item = {
      status: "reading" as const,
      readingMinutes: 69,
      pageFlips: 84,
    }
    const length = { pages: 100, runtimeMinutes: 100 }
    expect(matchedKindleStatus(item, length)).toBe("reading")
    expect(matchedKindleStatus({ ...item, pageFlips: 85 }, length)).toBe(
      "probably_read",
    )
    expect(matchedKindleStatus({ ...item, readingMinutes: 70 }, length)).toBe(
      "probably_read",
    )
    expect(
      matchedKindleStatus(item, { pages: null, runtimeMinutes: null }),
    ).toBe("reading")
    expect(
      matchedKindleStatus(
        { ...item, status: "abandoned", pageFlips: 85 },
        length,
      ),
    ).toBe("probably_read")
  })

  it("rejects ZIPs with no supported book-title data", async () => {
    await expect(
      parseKindle(
        await zip({ "Retail.Orders.csv": "ASIN,Title\nB000000009,Private\n" }),
        now,
      ),
    ).rejects.toThrow(/no book titles/)
    await expect(parseKindle(Buffer.from("no zip"), now)).rejects.toThrow(
      /ZIP archive/,
    )
  })
})
