import { randomUUID } from "node:crypto"

import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { type TestDbContext, setupTestDb } from "@/__tests__/harness/testDb"
import { GET as getInterview } from "@/app/api/v2/recommendations/interview/route"
import { PUT as putPreferences } from "@/app/api/v2/recommendations/preferences/route"
import { setCatalogForTests } from "@/catalog"
import { createImportJob, getHistoryItems } from "@/database/readingHistory"
import {
  createRound,
  ensureReader,
  getAllPicks,
  getReader,
  getRounds,
  preferencesOf,
} from "@/database/recommendations"
import { ask } from "@/recommendations/ask"
import { setModelCallerForTests } from "@/recommendations/model"
import { loadReaderData } from "@/recommendations/reader"
import {
  drainRounds,
  recoverInterruptedRounds,
  startRound,
} from "@/recommendations/rounds"
import {
  checkNewInSeries,
  dailySlot,
  tick,
  weeklySlot,
} from "@/recommendations/scheduler"
import { setPickState } from "@/recommendations/state"
import { bookStatusChanged } from "@/recommendations/triggers"
import { type InterviewView, type PickView } from "@/recommendations/types"
import { buildRecommendationsView } from "@/recommendations/views"
import { type UUID } from "@/uuid"

import {
  FakeCatalog,
  FakeModel,
  privateShelf,
  seedLibraryBook,
  seedReader,
  statusUuid,
} from "./fixtures"

const AI = {
  apiKey: "test",
  model: "claude-sonnet-5-5",
  fastModel: "claude-haiku-5-5",
  monthlyBudgetUsd: 5,
}

vi.mock("@/recommendations/ai", () => ({
  getAiConfig: () => Promise.resolve(AI),
}))

let ctx: TestDbContext
let catalog: FakeCatalog
let model: FakeModel
let reader: UUID
let shelf: UUID

/** A reader who loves naval fiction and one military SF series. */
function seedNavalReader(): void {
  reader = seedReader(ctx, "reader-a")
  shelf = privateShelf(ctx, reader)
  const read = (
    title: string,
    author: string,
    series?: { name: string; position: number },
  ) =>
    seedLibraryBook(ctx, {
      title,
      author,
      shelf,
      reader,
      status: "Read",
      rating: 5,
      series,
    })
  read("Master and Commander", "Patrick O'Brian", {
    name: "Aubrey/Maturin",
    position: 1,
  })
  read("Post Captain", "Patrick O'Brian", {
    name: "Aubrey/Maturin",
    position: 2,
  })
  read("Terms of Enlistment", "Marko Kloos", {
    name: "Frontlines",
    position: 1,
  })
  read("Lines of Departure", "Marko Kloos", { name: "Frontlines", position: 2 })
  read("Angles of Attack", "Marko Kloos", { name: "Frontlines", position: 3 })
  read("Sharpe's Eagle", "Bernard Cornwell")
}

async function view(userId: UUID = reader) {
  const prefs = preferencesOf(await getReader(userId))
  return await buildRecommendationsView(
    userId,
    await loadReaderData(userId, prefs),
    AI,
  )
}

function titles(picks: PickView[]): string[] {
  return picks.map((pick) => pick.work.title)
}

async function round(
  userId: UUID = reader,
  trigger: Parameters<typeof startRound>[1] = "refresh",
) {
  const started = await startRound(userId, trigger)
  await drainRounds()
  return started
}

beforeEach(() => {
  ctx = setupTestDb()
  catalog = new FakeCatalog()
  setCatalogForTests(catalog)
  model = new FakeModel()
  model.proposals = [
    { title: "Killer of Men", author: "Christian Cameron", kind: "new" },
    { title: "The Gates of Rome", author: "Conn Iggulden", kind: "new" },
    { title: "An Invented Book", author: "Nobody Real", kind: "new" },
    { title: "Le Livre", author: "Jean Auteur", kind: "new" },
    { title: "Future Book", author: "Pat Later", kind: "new" },
    { title: "Gardening Basics", author: "Pat Green", kind: "stretch" },
    { title: "The Hobbit", author: "J. R. R. Tolkien", kind: "stretch" },
  ]
  setModelCallerForTests(model.caller)
  seedNavalReader()
})

afterEach(() => {
  setCatalogForTests(null)
  setModelCallerForTests(undefined)
  globalThis.bookRequestPush = undefined
  ctx[Symbol.dispose]()
})

describe("a full round", () => {
  it("shows only verified, unread, released books in the reader's language", async () => {
    await round()
    const current = await view()
    const all = current.sections.flatMap((section) => section.picks)
    const shown = titles(all)

    expect(current.sections.map((section) => section.section)).toEqual([
      "series",
      "discover",
    ])
    // the next unread Aubrey/Maturin book, not one already read
    expect(titles(current.sections[0]!.picks)).toEqual(["HMS Surprise"])
    expect(shown).toContain("Killer of Men")
    // Kloos's other series starts at book 1
    expect(shown).toContain("Aftershocks")
    expect(shown).not.toContain("Ballistic")
    for (const absent of [
      "An Invented Book",
      "Le Livre",
      "Future Book",
      "Master and Commander",
      "Angles of Attack",
    ]) {
      expect(shown).not.toContain(absent)
    }
    expect(
      all.filter((pick) => pick.pill === "stretch").length,
    ).toBeLessThanOrEqual(1)
    expect(current.forYou.length).toBeGreaterThan(0)
    for (const pick of all) expect(pick.evidence.length).toBeGreaterThan(0)
  })

  it("reads ids the model answers with their text attached", async () => {
    model.verboseIds = true
    await round()
    const shown = titles((await view()).sections.flatMap((s) => s.picks))
    expect(shown).toContain("HMS Surprise")
    expect(shown).toContain("Killer of Men")
  })

  it("keeps a saved book out of every current section, not just its own round", async () => {
    await round()
    await round(reader, "tune")
    const rows = (await getAllPicks(reader)).filter(
      (pick) => pick.work.title === "Killer of Men",
    )
    expect(rows.length).toBeGreaterThan(1)
    const copies = (await view()).sections
      .flatMap((s) => s.picks)
      .filter((pick) => pick.work.title === "Killer of Men")
    expect(copies).toHaveLength(1)
    await setPickState(reader, copies[0]!.uuid, "saved")
    const after = await view()
    expect(
      titles([...after.sections.flatMap((s) => s.picks), ...after.forYou]),
    ).not.toContain("Killer of Men")
    expect(titles(after.saved)).toEqual(["Killer of Men"])
  })

  it("shows one edition when the catalog titles another with its series in front", async () => {
    model.proposals.push({
      title: "The Long War: Killer of Men",
      author: "Christian Cameron",
      kind: "new",
    })
    await round()
    const shown = titles((await view()).sections.flatMap((s) => s.picks))
    expect(
      shown.filter((title) => title.includes("Killer of Men")),
    ).toHaveLength(1)
  })

  it("drops a pick whose reason cites no real evidence", async () => {
    model.citeNothing.add("Killer of Men")
    await round()
    const shown = titles(
      (await view()).sections.flatMap((section) => section.picks),
    )
    expect(shown).not.toContain("Killer of Men")
    expect(shown).toContain("The Gates of Rome")
  })

  it("never recommends a book the reader owns or has asked for", async () => {
    seedLibraryBook(ctx, {
      title: "HMS Surprise",
      author: "Patrick O'Brian",
      shelf,
    })
    ctx.sqlite
      .prepare(
        `INSERT INTO book_request (user_id, kind, input, chosen_work, book_uuid, collection_uuid)
         VALUES (?, 'title', '{}', ?, ?, ?)`,
      )
      .run(
        reader,
        JSON.stringify({
          title: "Killer of Men",
          authors: ["Christian Cameron"],
        }),
        randomUUID(),
        shelf,
      )
    await round()
    const shown = titles(
      (await view()).sections.flatMap((section) => section.picks),
    )
    expect(shown).not.toContain("HMS Surprise")
    expect(shown).not.toContain("Killer of Men")
  })

  it("loads a legacy single length and labels a shorter series", async () => {
    await ensureReader(reader)
    await ctx.db
      .updateTable("recommendationReader")
      .set({ prefs: JSON.stringify({ seriesLength: "long" }) })
      .where("userId", "=", reader)
      .execute()
    expect(preferencesOf(await getReader(reader)).seriesLength).toEqual([
      "long",
    ])
    model.proposals.push({
      title: "First Watch",
      author: "Jane Harbor",
      kind: "new",
    })
    model.fits.set("First Watch", 95)
    await round()
    const pick = (await view()).sections
      .flatMap((section) => section.picks)
      .find((each) => each.work.title === "First Watch")
    expect(pick?.label).toBe("Shorter: 3 books")
    expect(pick?.series?.books).toBe(3)
  })

  it("uses an OR brief for multiple lengths and saves them as the reader's usual", async () => {
    await startRound(reader, "tune", {
      answers: { seriesLength: ["medium", "long"], saveAsUsual: true },
    })
    await drainRounds()
    expect(preferencesOf(await getReader(reader)).seriesLength).toEqual([
      "medium",
      "long",
    ])
    expect(
      model.prompts.some((prompt) =>
        prompt.includes(
          "Preferred series lengths (any of): medium (5–9 books) or long (10+ books)",
        ),
      ),
    ).toBe(true)
  })
})

describe("reader recommendation settings", () => {
  async function authenticatedRequest(
    userId: UUID,
    method = "GET",
    body?: unknown,
  ) {
    const sessionToken = randomUUID()
    await ctx.db
      .insertInto("session")
      .values({
        userId,
        sessionToken,
        expires: new Date(Date.now() + 60_000),
      })
      .execute()
    return new NextRequest("http://localhost/api/v2/recommendations", {
      method,
      headers: { Authorization: `Bearer ${sessionToken}` },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
  }

  it("returns the reader's subjects even before they have finished enough books", async () => {
    const coldReader = seedReader(ctx, "cold-reader")
    const book = seedLibraryBook(ctx, {
      title: "The Caravan",
      author: "Jay Porter",
      shelf: privateShelf(ctx, coldReader),
      reader: coldReader,
      status: "Reading",
    })
    const tag = randomUUID()
    ctx.sqlite
      .prepare("INSERT INTO tag (uuid, name) VALUES (?, ?)")
      .run(tag, "Desert exploration")
    ctx.sqlite
      .prepare("INSERT INTO book_to_tag (book_uuid, tag_uuid) VALUES (?, ?)")
      .run(book, tag)

    const response = await getInterview(
      await authenticatedRequest(coldReader),
      { params: Promise.resolve({}) },
    )
    expect(response?.status).toBe(200)
    const body = (await response?.json()) as InterviewView
    expect(body.coldStart).toBe(true)
    expect(body.subjects).toEqual(["Desert exploration"])

    const other = await getInterview(await authenticatedRequest(reader), {
      params: Promise.resolve({}),
    })
    expect(other?.status).toBe(200)
    const otherBody = (await other?.json()) as InterviewView
    expect(otherBody.subjects).not.toContain("Desert exploration")
  })

  it("normalizes all lengths to Any and keeps favor and avoid subjects exclusive", async () => {
    const change = await putPreferences(
      await authenticatedRequest(reader, "PUT", {
        seriesLength: ["medium", "short", "long"],
        favorSubjects: ["  Space   opera", " space OPERA ", "Naval adventure"],
        avoidSubjects: ["NAVAL Adventure"],
      }),
      { params: Promise.resolve({}) },
    )
    expect(change?.status).toBe(200)
    expect(await change?.json()).toMatchObject({
      seriesLength: [],
      favorSubjects: ["Space opera"],
      avoidSubjects: ["NAVAL Adventure"],
    })

    const moved = await putPreferences(
      await authenticatedRequest(reader, "PUT", {
        favorSubjects: ["Naval adventure"],
      }),
      { params: Promise.resolve({}) },
    )
    expect(moved?.status).toBe(200)
    expect(preferencesOf(await getReader(reader))).toMatchObject({
      favorSubjects: ["Naval adventure"],
      avoidSubjects: [],
    })
  })
})

describe("the reader's answers to picks", () => {
  it("removes Not for me for good and rests Not now for eight weeks", async () => {
    await round()
    const picks = (await view()).sections.flatMap((section) => section.picks)
    const killer = picks.find((pick) => pick.work.title === "Killer of Men")!
    const gates = picks.find((pick) => pick.work.title === "The Gates of Rome")!
    await setPickState(reader, killer.uuid, "not_for_me", {
      reason: "not_my_thing",
    })
    const rested = await setPickState(reader, gates.uuid, "not_now")
    const weeks =
      (Date.parse(rested.restedUntil!) - Date.now()) / (7 * 86_400_000)
    expect(Math.round(weeks)).toBe(8)

    await round()
    const shown = titles(
      (await view()).sections.flatMap((section) => section.picks),
    )
    expect(shown).not.toContain("Killer of Men")
    expect(shown).not.toContain("The Gates of Rome")
  })

  it("records Already read on a book outside the library so no import removes it", async () => {
    await round()
    const killer = (await view()).sections
      .flatMap((section) => section.picks)
      .find((pick) => pick.work.title === "Killer of Men")!
    await setPickState(reader, killer.uuid, "already_read", { rating: 4 })
    await createImportJob(reader, "goodreads", [])

    const manual = await getHistoryItems(reader, { sources: ["manual"] })
    expect(
      manual.map((item) => [item.title, item.rating, item.status]),
    ).toEqual([["Killer of Men", 4, "read"]])
    await round()
    const shown = titles(
      (await view()).sections.flatMap((section) => section.picks),
    )
    expect(shown).not.toContain("Killer of Men")
  })

  it("takes a pick off the row as soon as the reader requests the book elsewhere", async () => {
    await round()
    expect(titles((await view()).forYou)).toContain("HMS Surprise")
    ctx.sqlite
      .prepare(
        `INSERT INTO book_request (user_id, kind, input, chosen_work, book_uuid, collection_uuid)
         VALUES (?, 'successor', '{}', ?, ?, ?)`,
      )
      .run(
        reader,
        JSON.stringify({ title: "HMS Surprise", authors: ["Patrick O'Brian"] }),
        randomUUID(),
        shelf,
      )
    const current = await view()
    expect(titles(current.forYou)).not.toContain("HMS Surprise")
    expect(
      titles(current.sections.flatMap((section) => section.picks)),
    ).not.toContain("HMS Surprise")
  })
})

describe("rounds and restarts", () => {
  it("a second tap returns the running round; a restart retries an interrupted round once", async () => {
    await round()
    const before = titles((await view()).forYou)
    const stuck = await createRound({
      userId: reader,
      trigger: "refresh",
      kind: "full",
      input: {},
    })
    expect((await startRound(reader, "refresh")).uuid).toBe(stuck.uuid)

    await recoverInterruptedRounds()
    // the previous picks keep showing while the retry waits
    expect(titles((await view()).forYou)).toEqual(before)
    await drainRounds()
    const rounds = await getRounds(reader)
    expect(rounds.find((each) => each.uuid === stuck.uuid)?.status).toBe(
      "failed",
    )
    const retry = rounds.find((each) => each.input.retryOf === stuck.uuid)
    expect(retry?.status).toBe("done")

    // a retry interrupted again is not retried a second time
    ctx.sqlite
      .prepare(
        `UPDATE recommendation_round SET status = 'running' WHERE uuid = ?`,
      )
      .run(retry!.uuid)
    await recoverInterruptedRounds()
    expect(
      (await getRounds(reader)).filter((each) => each.status === "running"),
    ).toEqual([])
  })

  it("starts what the reader asked for while an automatic round runs", async () => {
    await ensureReader(reader)
    const weekly = await createRound({
      userId: reader,
      trigger: "weekly",
      kind: "full",
      input: {},
    })
    const asked = await startRound(reader, "wish", { wish: "naval adventure" })
    expect(asked.uuid).not.toBe(weekly.uuid)
    expect(asked.trigger).toBe("wish")
    await drainRounds()
    expect(
      (await getRounds(reader)).find((each) => each.uuid === asked.uuid)
        ?.status,
    ).toBe("done")
  })

  it("drops a queued wish the reader refined, so the newest wish lands last", async () => {
    await ensureReader(reader)
    const first = await startRound(reader, "wish", { wish: "sea stories" })
    const middle = await startRound(reader, "wish", { wish: "sea, standalone" })
    const last = await startRound(reader, "wish", {
      wish: "sea, standalone, short",
    })
    await drainRounds()
    const rounds = await getRounds(reader)
    const status = (uuid: UUID) =>
      rounds.find((each) => each.uuid === uuid)?.status
    // the first had already started; it is never cut off
    expect(status(first.uuid)).toBe("done")
    expect(status(middle.uuid)).toBe("failed")
    expect(status(last.uuid)).toBe("done")
  })

  it("keeps the previous picks when a round fails", async () => {
    await round()
    const before = titles((await view()).forYou)
    model.fail = true
    await round()
    expect((await getRounds(reader))[0]?.status).toBe("failed")
    expect(titles((await view()).forYou)).toEqual(before)
  })

  it("never puts one reader's data in another reader's prompt", async () => {
    const other = seedReader(ctx, "reader-b")
    const otherShelf = privateShelf(ctx, other)
    for (const title of ["Private Garden Diaries", "Secret Orchard"]) {
      seedLibraryBook(ctx, {
        title,
        author: "Quill Private",
        shelf: otherShelf,
        reader: other,
        status: "Read",
        rating: 5,
      })
    }
    model.prompts = []
    await round(reader)
    const mine = model.prompts.join("\n")
    model.prompts = []
    await round(other)
    const theirs = model.prompts.join("\n")
    expect(theirs).toContain("Secret Orchard")
    expect(mine).toContain("Post Captain")
    expect(mine).not.toContain("Secret Orchard")
    expect(mine).not.toContain("Quill Private")
    expect(theirs).not.toContain("Post Captain")
    expect(theirs).not.toContain("Kloos")
  })
})

describe("finishing a book", () => {
  it("starts an anchored round once the window closes with one book in it", async () => {
    await ensureReader(reader)
    const surprise = seedLibraryBook(ctx, {
      title: "HMS Surprise",
      author: "Patrick O'Brian",
      shelf,
      series: { name: "Aubrey/Maturin", position: 3 },
    })
    ctx.sqlite
      .prepare(
        `INSERT INTO book_to_status (book_uuid, status_uuid, user_id) VALUES (?, ?, ?)`,
      )
      .run(surprise, statusUuid(ctx, "Read"), reader)
    const now = Date.now()
    await bookStatusChanged(
      reader,
      surprise,
      null,
      statusUuid(ctx, "Read"),
      now,
    )
    await tick(new Date(now + 10 * 60_000))
    expect(
      (await getRounds(reader)).filter((each) => each.trigger === "finished"),
    ).toEqual([])
    await tick(new Date(now + 31 * 60_000))
    await drainRounds()
    const anchored = (await getRounds(reader)).find(
      (each) => each.trigger === "finished",
    )
    expect(anchored?.status).toBe("done")
    const current = await view()
    expect(current.sections[0]?.title).toBe("Because you finished HMS Surprise")
    expect(titles(current.sections[0]!.picks)[0]).toBe("The Mauritius Command")
  })

  it("starts nothing when several books are marked read together", async () => {
    await ensureReader(reader)
    const read = statusUuid(ctx, "Read")
    const now = Date.now()
    for (const title of ["HMS Surprise", "Killer of Men"]) {
      const book = seedLibraryBook(ctx, { title, author: "Someone", shelf })
      await bookStatusChanged(reader, book, null, read, now)
    }
    await tick(new Date(now + 31 * 60_000))
    await drainRounds()
    expect(
      (await getRounds(reader)).filter((each) => each.trigger === "finished"),
    ).toEqual([])
  })

  it("starts no second round when Read syncs after the reader asked what next", async () => {
    await ensureReader(reader)
    const read = statusUuid(ctx, "Read")
    const book = seedLibraryBook(ctx, {
      title: "HMS Surprise",
      author: "Patrick O'Brian",
      shelf,
    })
    await startRound(reader, "finished", { anchorBookUuid: book })
    await drainRounds()
    const now = Date.now()
    await bookStatusChanged(reader, book, null, read, now)
    await tick(new Date(now + 31 * 60_000))
    await drainRounds()
    expect(
      (await getRounds(reader)).filter((each) => each.trigger === "finished"),
    ).toHaveLength(1)
  })
})

describe("the schedule", () => {
  it("finds the weekly and daily slots in server time", () => {
    const wednesday = new Date(2026, 10, 25, 12, 0)
    const sunday = weeklySlot(wednesday)
    expect([sunday.getDay(), sunday.getHours(), sunday.getDate()]).toEqual([
      0, 5, 22,
    ])
    expect(weeklySlot(new Date(2026, 10, 22, 4, 59)).getDate()).toBe(15)
    expect(dailySlot(new Date(2026, 10, 25, 3, 0)).getDate()).toBe(24)
  })

  it("adds a newly released series book once and notifies once", async () => {
    await round()
    const sent: string[] = []
    globalThis.bookRequestPush = (_token, message) => {
      sent.push(message.title)
      expect(message.channel).toBe("recommendations")
      return Promise.resolve(true)
    }
    ctx.sqlite
      .prepare(
        `INSERT INTO user_device (install_id, user_id, platform, push_token) VALUES ('i1', ?, 'android', 't1')`,
      )
      .run(reader)
    // read #1–3 long ago; #4 came out after that (the update trigger would
    // stamp the change with today, so it is set aside for the backdating)
    seedLibraryBook(ctx, {
      title: "HMS Surprise",
      author: "Patrick O'Brian",
      shelf,
      reader,
      status: "Read",
      rating: 5,
      series: { name: "Aubrey/Maturin", position: 3 },
    })
    ctx.sqlite.exec(`DROP TRIGGER book_to_status_event_update_trigger`)
    ctx.sqlite
      .prepare(
        `UPDATE book_to_status SET updated_at = '2015-01-01 00:00:00' WHERE user_id = ?`,
      )
      .run(reader)
    catalog.series.get("audible:AM")!.books[3]!.work.releaseDate = "2020-05-01"

    const row = (await getReader(reader))!
    expect(await checkNewInSeries(reader, row)).toBe(1)
    expect(await checkNewInSeries(reader, row)).toBe(0)
    expect(sent).toEqual(["New book in Aubrey/Maturin: #4"])
    const pick = (await view()).sections
      .flatMap((section) => section.picks)
      .find((each) => each.work.title === "The Mauritius Command")
    expect(pick?.pill).toBe("new")
  })

  it("pauses weekly rounds once the monthly budget is spent", async () => {
    await ensureReader(reader)
    ctx.sqlite
      .prepare(
        `UPDATE recommendation_reader SET last_weekly_at = '2000-01-01 00:00:00' WHERE user_id = ?`,
      )
      .run(reader)
    const spent = await createRound({
      userId: reader,
      trigger: "refresh",
      kind: "full",
      input: {},
    })
    ctx.sqlite
      .prepare(
        `UPDATE recommendation_round SET status = 'failed', cost_microusd = 6000000 WHERE uuid = ?`,
      )
      .run(spent.uuid)
    await tick()
    await drainRounds()
    expect(
      (await getRounds(reader)).filter((each) => each.trigger === "weekly"),
    ).toEqual([])
    expect((await view()).budgetPaused).toBe(true)
  })
})

describe("Ask", () => {
  it("turns named books into cards, asks about ambiguous titles and admits what it cannot find", async () => {
    const other = seedReader(ctx, "reader-b")
    seedLibraryBook(ctx, {
      title: "Killer of Men",
      author: "Christian Cameron",
      shelf: privateShelf(ctx, other),
    })
    model.ask = {
      intent: "get",
      books: [
        {
          title: "The Gates of Rome",
          author: null,
          series: null,
          number: null,
        },
        {
          title: "Killer of Men",
          author: "Christian Cameron",
          series: null,
          number: null,
        },
        { title: "The Hobbit", author: null, series: null, number: null },
        {
          title: "A Book Nobody Wrote",
          author: null,
          series: null,
          number: null,
        },
        { title: "Emperor", author: null, series: "Emperor", number: 2 },
        { title: "Post Captain", author: null, series: null, number: null },
      ],
      wish: null,
    }
    const result = await ask(reader, AI, "anything")
    if (result.intent !== "get") throw new Error(result.intent)
    expect(result.cards.map((card) => [card.work.title, card.state])).toEqual([
      ["The Gates of Rome", "get"],
      ["Killer of Men", "household"],
      ["The Death of Kings", "get"],
      ["Post Captain", "on_shelf"],
    ])
    expect(result.questions).toHaveLength(1)
    expect(
      result.questions[0]!.choices.map((card) => card.work.authors[0]),
    ).toEqual(["J. R. R. Tolkien", "Someone Else"])
    expect(result.notFound).toEqual(["A Book Nobody Wrote"])
    // a household card names no other reader
    expect(JSON.stringify(result)).not.toContain("reader-b")
    expect(await getAllPicks(reader)).toEqual([])
  })

  it("starts an anchored round for a finished book in the library", async () => {
    model.ask = {
      intent: "next",
      books: [
        { title: "Post Captain", author: null, series: null, number: null },
      ],
      wish: null,
    }
    const result = await ask(reader, AI, "I just finished Post Captain")
    if (result.intent !== "next") throw new Error(result.intent)
    expect(result.anchor.read).toBe(true)
    await drainRounds()
    expect((await getRounds(reader))[0]?.trigger).toBe("finished")
    expect((await getRounds(reader))[0]?.status).toBe("done")
  })
})
