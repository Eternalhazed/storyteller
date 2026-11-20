import { UNSPACED_SCRIPT, aliasKey } from "./matcher.ts"
import type { XrayEntity } from "./model.ts"
import {
  type DraftEntity,
  leadingWordUsers,
  mergeDuplicates,
  pruneSharedTitles,
} from "./registry.ts"
import type { SegmentRange } from "./segments.ts"

export type StampedEntity = Omit<XrayEntity, "mentions">

/**
 * Decide when a reader may see each thing recorded about an entity.
 *
 * While a book is being read, every item is stamped with the sentence it came
 * from. That is right for the words of the book itself, but most of what is
 * recorded is the model's own judgement, formed with a whole passage in
 * view: that two names belong to one person, or how a fact should be put.
 * Shown at its sentence, such an item could give away something the passage
 * only says later. So the rule is:
 *
 * - The name an entity first appears under is visible where it appears.
 * - Another name is visible where it appears only if it visibly belongs with
 *   a name the reader already has ("Hook" with "James Hook"). Otherwise it
 *   waits for the end of the passage that tied it to the entity.
 * - The listed name follows the visibility of the name it is.
 * - A fact still points at its sentence, but waits for the end of its
 *   passage. Descriptions already do.
 */
export function stampEntities(
  drafts: readonly DraftEntity[],
  segments: readonly SegmentRange[],
): StampedEntity[] {
  const entities = mergeDuplicates(drafts)
  const passageEnd = (ordinal: number) =>
    (segments.find(
      (segment) => ordinal >= segment.start && ordinal < segment.end,
    )?.end ?? ordinal + 1) - 1

  // Titles and common first names do not show that two names belong together.
  const titles = new Set(
    [...leadingWordUsers(entities)]
      .filter(([, users]) => users.size > 1)
      .map(([word]) => word),
  )
  const wordsOf = (key: string) =>
    key.split(/[^\p{L}\p{N}']+/u).filter((word) => {
      return word.length > 2 && !titles.has(word)
    })
  const belongTogether = (a: string, b: string) => {
    if (UNSPACED_SCRIPT.test(a) || UNSPACED_SCRIPT.test(b)) {
      return a.includes(b) || b.includes(a)
    }
    const words = new Set(wordsOf(a))
    return wordsOf(b).some((word) => words.has(word))
  }

  return pruneSharedTitles(entities).map(({ lastSeen: _, ...entity }) => {
    const visibleAt = new Map<string, number>()
    const inOrder = [...entity.aliases].sort((a, b) => a.at - b.at)
    for (const alias of inOrder) {
      const key = aliasKey(alias.text)
      if (!visibleAt.size) {
        visibleAt.set(key, alias.at)
        continue
      }
      const tied = [...visibleAt]
        .filter(([other]) => belongTogether(key, other))
        .map(([, at]) => at)
      visibleAt.set(
        key,
        tied.length
          ? Math.min(
              passageEnd(alias.at),
              Math.max(alias.at, Math.min(...tied)),
            )
          : passageEnd(alias.at),
      )
    }

    return {
      ...entity,
      aliases: entity.aliases.map((alias) => ({
        text: alias.text,
        at: visibleAt.get(aliasKey(alias.text)) ?? passageEnd(alias.at),
      })),
      names: entity.names.flatMap((name) => {
        const at = visibleAt.get(aliasKey(name.text))
        return at === undefined ? [] : [{ text: name.text, at }]
      }),
      facts: entity.facts.map((fact) => ({
        text: fact.text,
        sentence: fact.at,
        at: passageEnd(fact.at),
      })),
    }
  })
}
