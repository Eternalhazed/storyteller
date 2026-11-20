# @storyteller-platform/xray

Builds an X-Ray file for an EPUB: the characters, places, groups, and things in
the book, what the text has said about each, and every sentence that names them.

The file is spoiler-safe by construction. A language model reads the book one
passage at a time, in reading order, and each thing it records is stamped with
the sentence a reader must reach before seeing it. A reading app passes the
reader's position to `viewXray` and gets back only what is stamped at or before
it.

## How it works

1. The book is split into sentences with the same code that
   `@storyteller-platform/align` uses to mark up a book for narration, so
   sentence `n` of spine item `id` is the element `<span id="{id}-s{n}">` in the
   aligned book.
2. The sentences are cut into passages of about 3,000 words that never cross a
   spine item.
3. For each passage, the model is given the entities known so far and the
   passage with its sentences numbered. It returns new entities, new names for
   known ones, a revised description, and notable facts that each cite a
   sentence.
4. Nothing the model returns is trusted beyond what the text backs up: a name is
   kept only if it appears literally in the passage, and a fact only if it cites
   a sentence in the passage.
5. Mentions are found without the model, by matching every known name against
   every sentence.

### What is visible when

The words of the book are visible where they stand. Anything the model wrote or
judged with a whole passage in view waits for the end of that passage:

- A mention is visible at its sentence, once the reader knows the name used in
  it belongs to the entity.
- The name an entity first appears under is visible where it appears. A fuller
  or shorter form of a name the reader already has ("Hook", "James Hook") is
  visible where it appears. Any other name waits for the end of the passage that
  tied it to the entity, so a reveal is never shown early.
- Descriptions, facts, and passage summaries wait for the end of their passage.
  A fact still records the sentence that states it, and that is where a reader
  is taken to see it.

## Usage

```ts
import { createAnthropicModel, generateXray } from "@storyteller-platform/xray"
import { readBookSource } from "@storyteller-platform/xray/epub"

const source = await readBookSource("book.epub")
const { xray } = await generateXray(source, {
  model: "claude-haiku-5-5",
  callModel: createAnthropicModel({ apiKey }),
})
```

`@storyteller-platform/xray/epub` is the only entry point that loads
`@storyteller-platform/align`, with its native and WebAssembly code. The main
entry point runs anywhere, so a server can read the book in a worker thread and
do the rest in its main process.

`readBookSource` must segment the book exactly as `markup` did when the book was
aligned, or sentence numbers will not match the aligned book. Both use the
language declared in the EPUB unless told otherwise, so pass a locale to one
only if you pass the same locale to the other.

Reading apps import from `@storyteller-platform/xray/view`, which has no Node
dependencies:

```ts
import { findEntity, viewXray } from "@storyteller-platform/xray/view"

const known = viewXray(xray, boundary)
const selected = findEntity(known, "Captain Hook")
```

`boundary` is an ordinal: the zero-based number of the last sentence the reader
has reached, counted across the whole book. `ordinalOfFragment` and
`ordinalAtProgression` convert a reading position to one, and `locateSentence`
converts back.

## Command line

```sh
ANTHROPIC_API_KEY=... yarn workspace @storyteller-platform/xray cli \
  generate book.epub --out xray.json --state xray.state.json

yarn workspace @storyteller-platform/xray cli show xray.json --at 0.25
```

`--state` saves progress after every passage, so an interrupted run resumes
without paying to reread what it has finished. A passage the model cannot answer
after several attempts is skipped and reported, so one bad passage does not stop
the book. `show` prints what a reader a quarter of the way through would see.

## Limits

- Two entries that the text later reveals to be the same character are not
  merged. A stranger who is renamed on being identified keeps one entry.
- Pronouns and descriptions ("the captain") are not resolved to an entity, so
  mentions are the sentences that use a name.
- The model is told to use only the passage in front of it, and invented names
  are rejected, but a description of a very famous book can still be coloured by
  what the model already knows.

## Tests

```sh
yarn workspace @storyteller-platform/xray test
```
