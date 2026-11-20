import type { DraftEntity } from "./registry.ts"
import type { SegmentRange } from "./segments.ts"

export const SYSTEM_PROMPT = `You are building a spoiler-free reader's index for a book, like Kindle X-Ray. You read the book one passage at a time, in order. Each time, you are given the entities recorded from earlier passages and the next passage, with every sentence numbered.

Record what this passage tells a reader about the notable characters, places, groups, and things in the story.

Sources:
- Use only the passage and the list of known entities. Never use anything you know about this book, its sequels or adaptations, or its author. A reader must not learn anything the text has not yet said.

Which entities:
- character: a person, animal, or other being with a part in the story.
- place: a named location.
- group: a family, organisation, military unit, crew, or people that the book refers to by a fixed name. The name may be lower-case if the book always writes it so ("the lost boys").
- thing: a named ship, object, or event, or an invented or specialist term a reader may want explained.
- Skip the incidental: unnamed one-off figures, ordinary objects, real-world references made in passing.
- Include an entity only if it is new, or if this passage says something new about it.

Names:
- An entity must be named in the passage. "name" is the short name the narration most often uses for it, copied exactly as the passage writes it.
- "aliases" are the other ways this passage names the same entity (full name, surname, nickname, title with name), each copied exactly as written.
- Never list pronouns or descriptions such as "the captain", "his mother", or "the boy" as a name or alias. A title, rank, or kinship word is part of an alias only together with a name: "Captain Hook", never "Captain" or "the Captain".
- If the entity is in the known list, use its id and repeat its name. A fuller form of the same name is an alias, not a new name. Give a different name only when the passage reveals that the known name was false or a stand-in, such as a stranger who turns out to be someone else. Never make a second entry for a known entity.
- If the entity is new, set "id" to null.

What to write:
- "description": one or two sentences, at most 40 words, in the present tense. Say first who or what this is, then where things stand for it as of the end of this passage. For a known entity, revise its existing description, keeping what still matters; do not just narrate this passage.
- "facts": what a reader coming back to the book would want to be reminded of: who someone is to someone else, a turning point, a death, a promise, a discovery, a change of side or status. Most entities have none in most passages, and none has more than two. Leave out routine actions and dialogue. Each fact is one short sentence, with the number of the passage sentence that states it. For a new entity, give one fact saying how it enters the story.
- "summary": one or two sentences on what happens in this passage.
- Write in the language of the passage.`

/** How many entities not named in the passage are still listed for context. */
const MAX_BACKGROUND_ENTITIES = 250

/**
 * The message for one passage: what is known so far, then the passage.
 *
 * Entities named in the passage come with their current description, so the
 * model revises it. The rest are listed by name only, most recently seen
 * first, so the model can recognise them under a new name.
 */
export function buildPassagePrompt(
  entities: readonly DraftEntity[],
  active: ReadonlySet<number>,
  segment: SegmentRange,
  sentences: readonly string[],
): string {
  const background = entities
    .filter((entity) => !active.has(entity.id))
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, MAX_BACKGROUND_ENTITIES)

  const lines = [
    ...entities.filter((entity) => active.has(entity.id)),
    ...background,
  ].map((entity) => {
    const name = entity.names.at(-1)?.text ?? ""
    const others = entity.aliases
      .map((alias) => alias.text)
      .filter((alias) => alias !== name)
    const description = active.has(entity.id)
      ? entity.descriptions.at(-1)?.text
      : undefined
    return [
      `${entity.id} | ${entity.type} | ${name}`,
      others.length ? ` | also: ${others.join("; ")}` : "",
      description ? ` | ${description}` : "",
    ].join("")
  })

  const passage = sentences
    .slice(segment.start, segment.end)
    .map((sentence, index) => `[${index + 1}] ${sentence}`)

  return [
    "Known entities (id | type | name | other names | description):",
    lines.length ? lines.join("\n") : "None yet.",
    "",
    "Passage:",
    passage.join("\n"),
  ].join("\n")
}
