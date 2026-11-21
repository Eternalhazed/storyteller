import assert from "node:assert/strict"

import { test } from "vitest"

import { periodicalsLast, withoutPeriodicals } from "./periodicals"

const book = (title: string, ...collections: string[]) => ({
  title,
  collections: collections.map((name) => ({ name })),
})

test("books in the Magazines collection stay off the reading shelves", () => {
  const books = [
    book("Consumer Reports", "David", " magazines "),
    book("Sharpe's Eagle", "David"),
    book("Loose book"),
  ]

  assert.deepEqual(
    withoutPeriodicals(books).map((b) => b.title),
    ["Sharpe's Eagle", "Loose book"],
  )
})

test("the Magazines shelf comes after every other collection", () => {
  const collections = [
    { name: "David" },
    { name: "Magazines" },
    { name: "Shley's Bookshelf" },
  ]

  assert.deepEqual(
    periodicalsLast(collections).map((c) => c.name),
    ["David", "Shley's Bookshelf", "Magazines"],
  )
})
