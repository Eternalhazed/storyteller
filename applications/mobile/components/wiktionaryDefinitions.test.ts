import assert from "node:assert/strict"
import test from "node:test"

import {
  getDefinitionCandidates,
  getDefinitionTerm,
  htmlToPlainText,
  lookupDefinition,
  parseDefinitionResponse,
} from "./wiktionaryDefinitions"

test("turns running-text selections into headwords", () => {
  assert.deepEqual(getDefinitionTerm("  \u201charpooneer,\u201d "), {
    ok: true,
    term: "harpooneer",
  })
  assert.deepEqual(getDefinitionTerm("\u2018Stern"), {
    ok: true,
    term: "Stern",
  })
  assert.deepEqual(getDefinitionTerm("don\u2019t"), { ok: true, term: "don't" })
  assert.deepEqual(getDefinitionTerm("Sub-Sub-Librarian)."), {
    ok: true,
    term: "Sub-Sub-Librarian",
  })
  assert.deepEqual(getDefinitionTerm("\u2014;!"), {
    ok: false,
    reason: "empty",
  })
  assert.deepEqual(getDefinitionTerm("Call me Ishmael. Some years ago"), {
    ok: false,
    reason: "too-many-words",
  })
})

test("falls back to lowercase and non-possessive headwords", () => {
  assert.deepEqual(getDefinitionCandidates("Ahab's"), [
    "Ahab's",
    "ahab's",
    "Ahab",
    "ahab",
  ])
  assert.deepEqual(getDefinitionCandidates("whale"), ["whale"])
})

test("strips Wiktionary markup and decodes entities", () => {
  assert.equal(
    htmlToPlainText(
      'A <a rel="mw:WikiLink" href="/wiki/harpooner">harpooner</a>, one who uses a <i>harpoon</i> &amp; line&#x2014;&#8220;whales&#8221;&nbsp;.',
    ),
    "A harpooner, one who uses a harpoon & line\u2014\u201cwhales\u201d .",
  )
  assert.equal(htmlToPlainText("&bogus; &#99999999;"), "&bogus; &#99999999;")
})

test("separates English usages and drops empty definitions", () => {
  assert.deepEqual(
    parseDefinitionResponse({
      de: [{ partOfSpeech: "Noun", language: "German", definitions: [] }],
      la: [
        {
          partOfSpeech: "Noun",
          language: "Latin",
          definitions: [{ definition: "whale" }],
        },
      ],
      en: [
        {
          partOfSpeech: "Noun",
          language: "English",
          definitions: [
            { definition: "" },
            { definition: "<span></span>" },
            { definition: "A <b>whale</b>." },
            null,
            { definition: 7 },
          ],
        },
        { partOfSpeech: "Verb", language: "English", definitions: [] },
        "unexpected",
      ],
    }),
    {
      english: [
        {
          language: "English",
          partOfSpeech: "Noun",
          definitions: ["A whale."],
          formOf: null,
        },
      ],
      other: [
        {
          language: "Latin",
          partOfSpeech: "Noun",
          definitions: ["whale"],
          formOf: null,
        },
      ],
    },
  )
  assert.deepEqual(parseDefinitionResponse(null), { english: [], other: [] })
  assert.deepEqual(parseDefinitionResponse({ en: "nope" }), {
    english: [],
    other: [],
  })
})

function fakeFetch(
  responses: Record<string, { status: number; body?: unknown }>,
) {
  const requested: string[] = []
  const fetch = (url: string) => {
    requested.push(url)
    const term = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1))
    const response = responses[term] ?? { status: 404 }
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: () => Promise.resolve(response.body),
    })
  }
  return { fetch, requested }
}

test("looks up the next candidate after a missing entry", async () => {
  const { fetch, requested } = fakeFetch({
    harpooneer: {
      status: 200,
      body: {
        en: [
          {
            partOfSpeech: "Noun",
            language: "English",
            definitions: [{ definition: "A harpooner." }],
          },
        ],
      },
    },
  })

  assert.deepEqual(await lookupDefinition("Harpooneer", { fetch }), {
    status: "found",
    term: "harpooneer",
    entries: [
      {
        language: "English",
        partOfSpeech: "Noun",
        definitions: ["A harpooner."],
        formOf: null,
      },
    ],
    inflection: null,
  })
  assert.deepEqual(requested, [
    "https://en.wiktionary.org/api/rest_v1/page/definition/Harpooneer",
    "https://en.wiktionary.org/api/rest_v1/page/definition/harpooneer",
  ])
})

function usage(language: string, definition: string) {
  return { partOfSpeech: "Noun", language, definitions: [{ definition }] }
}

test("prefers a later English entry over an earlier foreign-only title", async () => {
  const { fetch } = fakeFetch({
    Some: { status: 200, body: { hrx: [usage("Hunsrik", "seed")] } },
    some: {
      status: 200,
      body: { en: [usage("English", "A certain number.")] },
    },
  })
  assert.deepEqual(await lookupDefinition("Some", { fetch }), {
    status: "found",
    term: "some",
    entries: [
      {
        language: "English",
        partOfSpeech: "Noun",
        definitions: ["A certain number."],
        formOf: null,
      },
    ],
    inflection: null,
  })

  const foreignOnly = fakeFetch({
    Bonjour: { status: 200, body: { fr: [usage("French", "hello")] } },
  })
  assert.deepEqual(
    await lookupDefinition("Bonjour", { fetch: foreignOnly.fetch }),
    {
      status: "found",
      term: "Bonjour",
      entries: [
        {
          language: "French",
          partOfSpeech: "Noun",
          definitions: ["hello"],
          formOf: null,
        },
      ],
      inflection: null,
    },
  )
})

const pluralOfWhale =
  '<span class="form-of-definition use-with-mention"><a href="/wiki/Appendix:Glossary">plural</a> of <span class="form-of-definition-link"><i lang="en"><a href="/wiki/whale#English" title="whale">whale</a></i></span></span>'

test("shows the lemma's definitions for an inflected form", async () => {
  const { fetch } = fakeFetch({
    whales: { status: 200, body: { en: [usage("English", pluralOfWhale)] } },
    whale: { status: 200, body: { en: [usage("English", "A large mammal.")] } },
  })
  assert.deepEqual(await lookupDefinition("whales", { fetch }), {
    status: "found",
    term: "whale",
    entries: [
      {
        language: "English",
        partOfSpeech: "Noun",
        definitions: ["A large mammal."],
        formOf: null,
      },
    ],
    inflection: { form: "whales", description: "plural of whale" },
  })

  const lemmaMissing = fakeFetch({
    whales: { status: 200, body: { en: [usage("English", pluralOfWhale)] } },
  })
  assert.deepEqual(
    await lookupDefinition("whales", { fetch: lemmaMissing.fetch }),
    {
      status: "found",
      term: "whales",
      entries: [
        {
          language: "English",
          partOfSpeech: "Noun",
          definitions: ["plural of whale"],
          formOf: "whale",
        },
      ],
      inflection: null,
    },
  )
})

test("leads with the lemma senses matching the inflection", async () => {
  const pastOfHarpoon = pluralOfWhale
    .replace("plural", "simple past")
    .replaceAll("whale", "harpoon")
  const { fetch } = fakeFetch({
    harpooned: {
      status: 200,
      body: {
        en: [{ ...usage("English", pastOfHarpoon), partOfSpeech: "Verb" }],
      },
    },
    harpoon: {
      status: 200,
      body: {
        en: [
          usage("English", "A barbed spear."),
          {
            ...usage("English", "To strike with a harpoon."),
            partOfSpeech: "Verb",
          },
        ],
      },
    },
  })

  const result = await lookupDefinition("harpooned", { fetch })
  assert.equal(result.status, "found")
  if (result.status !== "found") return
  assert.deepEqual(
    result.entries.map((entry) => entry.partOfSpeech),
    ["Verb", "Noun"],
  )
  assert.deepEqual(result.inflection, {
    form: "harpooned",
    description: "simple past of harpoon",
  })
})

test("reports a missing entry and surfaces server failures", async () => {
  assert.deepEqual(
    await lookupDefinition("Queequeg", { fetch: fakeFetch({}).fetch }),
    { status: "not-found", term: "Queequeg" },
  )
  await assert.rejects(
    lookupDefinition("whale", {
      fetch: fakeFetch({ whale: { status: 503 } }).fetch,
    }),
    /HTTP 503/,
  )
})
