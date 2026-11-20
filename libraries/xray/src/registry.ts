import { z } from "zod"

import { AliasMatcher, aliasKey } from "./matcher.ts"
import {
  type XrayEntityType,
  type XrayStamped,
  xrayEntityTypes,
} from "./model.ts"
import type { SegmentRange } from "./segments.ts"

/** What the model returns after reading one passage. */
export const segmentOutputSchema = z.object({
  summary: z.string(),
  entities: z.array(
    z.object({
      id: z.number().int().nullable(),
      type: z.enum(xrayEntityTypes),
      name: z.string(),
      aliases: z.array(z.string()),
      description: z.string(),
      facts: z.array(
        z.object({
          sentence: z.number().int(),
          text: z.string(),
        }),
      ),
    }),
  ),
})

export type SegmentOutput = z.infer<typeof segmentOutputSchema>

export interface DraftEntity {
  id: number
  type: XrayEntityType
  names: XrayStamped[]
  aliases: XrayStamped[]
  descriptions: XrayStamped[]
  facts: XrayStamped[]
  /** Index of the last passage that named this entity. */
  lastSeen: number
}

const MAX_DESCRIPTION_LENGTH = 400
const MAX_FACT_LENGTH = 240
const MAX_FACTS_PER_PASSAGE = 3
const MAX_ALIAS_LENGTH = 80

const NOT_NAMES = new Set(
  "i me my mine you your yours he him his she her hers it its we us our ours they them their theirs the a an this that these those".split(
    " ",
  ),
)

/**
 * Whether a string can stand for one entity throughout the book.
 *
 * A character or place needs a capital somewhere, which rules out
 * descriptions like "the captain" that would match several people. Groups
 * and things often go by a fixed lower-case name ("the lost boys"). Scripts
 * without letter case are exempt.
 */
function isUsableAlias(alias: string, type: XrayEntityType): boolean {
  const key = aliasKey(alias)
  if (key.length < 2 || key.length > MAX_ALIAS_LENGTH) return false
  if (NOT_NAMES.has(key)) return false

  const needsCapital = type === "character" || type === "place"
  const hasCase = alias.toLowerCase() !== alias.toUpperCase()
  return !(needsCapital && hasCase && alias === alias.toLowerCase())
}

interface Occurrences {
  /** Ordinal of the first sentence in the passage that uses the name. */
  first: number
  /** How many sentences of the passage use it. */
  count: number
}

/**
 * Where a candidate name is used in the passage, or null if it never is.
 *
 * Each name is looked for on its own, so a short name is found inside a
 * longer form of itself: "Cecco" appears wherever "the Italian Cecco" does.
 */
function findOccurrences(
  name: string,
  segment: SegmentRange,
  sentences: readonly string[],
): Occurrences | null {
  const matcher = new AliasMatcher([[name, true]])
  let found: Occurrences | null = null
  for (let ordinal = segment.start; ordinal < segment.end; ordinal++) {
    if (!matcher.find(sentences[ordinal] ?? "").length) continue
    if (found) found.count++
    else found = { first: ordinal, count: 1 }
  }
  return found
}

/**
 * The first word of every multi-word alias, with the ids of the entities
 * that have an alias starting with it. A word that leads names of several
 * entities ("Captain", "Tribune", "Tertius") is a title or a common first
 * name, not something that identifies one of them.
 */
export function leadingWordUsers(
  entities: readonly DraftEntity[],
): Map<string, Set<number>> {
  const leadingWords = new Map<string, Set<number>>()
  for (const entity of entities) {
    for (const alias of entity.aliases) {
      const [first, ...rest] = aliasKey(alias.text).split(/\s+/)
      if (!first || !rest.length) continue
      const users = leadingWords.get(first) ?? new Set()
      leadingWords.set(first, users.add(entity.id))
    }
  }
  return leadingWords
}

/**
 * Drop one-word aliases that are really a title or a shared first name.
 *
 * "Tribune" may be recorded as a way the text refers to one man, but if
 * another entity is "Tribune Lucca", the bare word does not pick anyone out,
 * and counting it would credit one entity with every tribune's mentions. An
 * entity never loses the name it is listed under.
 */
export function pruneSharedTitles(entities: readonly DraftEntity[]) {
  const leadingWords = leadingWordUsers(entities)

  return entities.map((entity) => {
    const names = new Set(entity.names.map((name) => aliasKey(name.text)))
    return {
      ...entity,
      aliases: entity.aliases.filter((alias) => {
        const key = aliasKey(alias.text)
        if (names.has(key)) return true
        const users = leadingWords.get(key)
        return !users || [...users].every((id) => id === entity.id)
      }),
    }
  })
}

/**
 * Fold what the model said about one passage into the entities so far.
 *
 * Nothing the model says is trusted beyond what the text can back up: a name
 * is kept only if it literally appears in the passage, and a fact only if it
 * cites a sentence of the passage. Everything kept is stamped with the
 * sentence at which a reader may see it.
 *
 * Returns a note for each thing that was rejected.
 */
export function applySegmentOutput(
  entities: DraftEntity[],
  output: SegmentOutput,
  segment: SegmentRange,
  segmentIndex: number,
  sentences: readonly string[],
): string[] {
  const rejections: string[] = []
  const lastOrdinal = segment.end - 1

  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  const owners = new Map<string, DraftEntity>()
  for (const entity of entities) {
    for (const alias of entity.aliases) owners.set(aliasKey(alias.text), entity)
  }

  for (const proposed of output.entities) {
    const candidates = new Map<string, string>()
    for (const text of [proposed.name, ...proposed.aliases]) {
      // "Nana's" is "Nana"; matching already sees through the possessive.
      const trimmed = text.trim().replace(/['’]s$/u, "")
      if (trimmed) candidates.set(aliasKey(trimmed), trimmed)
    }

    // A proposed entity is the known one it names by id, or failing that the
    // known one that already owns one of its names.
    let entity = proposed.id === null ? undefined : byId.get(proposed.id)
    if (proposed.id !== null && !entity) {
      rejections.push(`unknown id ${proposed.id} for "${proposed.name}"`)
    }
    // The id says one entity and the name another: the model has slipped,
    // and there is no telling which of the two its notes are about.
    const nameOwner = owners.get(aliasKey(proposed.name))
    if (entity && nameOwner && nameOwner !== entity) {
      rejections.push(
        `id ${entity.id} is "${entity.names.at(-1)?.text}", not "${proposed.name}"`,
      )
      continue
    }
    for (const key of candidates.keys()) {
      entity ??= owners.get(key)
    }
    const type = entity?.type ?? proposed.type

    const added: (XrayStamped & { count: number })[] = []
    for (const [key, text] of candidates) {
      const owner = owners.get(key)
      if (owner) {
        if (entity && owner !== entity) {
          rejections.push(
            `"${text}" already names "${owner.names.at(-1)?.text}"`,
          )
        }
        continue
      }
      if (!isUsableAlias(text, type)) {
        rejections.push(`"${text}" is not a usable name`)
        continue
      }
      const found = findOccurrences(text, segment, sentences)
      if (!found) {
        rejections.push(`"${text}" does not appear in the passage`)
        continue
      }
      added.push({ text, at: found.first, count: found.count })
    }

    if (!entity) {
      if (!added.length) {
        rejections.push(`no usable name for "${proposed.name}"`)
        continue
      }
      entity = {
        id: entities.length,
        type,
        names: [],
        aliases: [],
        descriptions: [],
        facts: [],
        lastSeen: segmentIndex,
      }
      entities.push(entity)
      byId.set(entity.id, entity)
    }

    for (const { text, at } of added) {
      entity.aliases.push({ text, at })
      owners.set(aliasKey(text), entity)
    }

    const nameKey = aliasKey(proposed.name)
    const newName = added.find((alias) => aliasKey(alias.text) === nameKey)
    if (!entity.names.length) {
      // A new entity goes by whichever of its names the passage uses most,
      // which is what a reader will look for. The model breaks ties. The
      // name is stamped where it is first used: until a reader gets there,
      // they see the entity under whichever name they have already met.
      const most = Math.max(...added.map((alias) => alias.count))
      const usual =
        newName?.count === most
          ? newName
          : added.find((alias) => alias.count === most)
      if (usual) entity.names.push({ text: usual.text, at: usual.at })
    } else if (newName) {
      // A name change is only believed when it comes with a name the passage
      // newly uses; otherwise the model is just wavering between old names.
      entity.names.push({ text: newName.text, at: newName.at })
    }

    const description = proposed.description.trim()
    if (
      description &&
      description.length <= MAX_DESCRIPTION_LENGTH &&
      description !== entity.descriptions.at(-1)?.text
    ) {
      entity.descriptions.push({ text: description, at: lastOrdinal })
    } else if (description.length > MAX_DESCRIPTION_LENGTH) {
      rejections.push(`description too long for "${proposed.name}"`)
    }

    for (const fact of proposed.facts.slice(0, MAX_FACTS_PER_PASSAGE)) {
      const text = fact.text.trim()
      const at = segment.start + fact.sentence - 1
      if (!text || text.length > MAX_FACT_LENGTH) {
        rejections.push(`unusable fact for "${proposed.name}"`)
      } else if (at < segment.start || at > lastOrdinal) {
        rejections.push(
          `fact for "${proposed.name}" cites sentence ${fact.sentence}, outside the passage`,
        )
      } else {
        entity.facts.push({ text, at })
      }
    }
  }

  return rejections
}
