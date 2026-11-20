/**
 * Finds literal occurrences of entity names in sentence text.
 *
 * Matching is deliberately dumb and deterministic: a name matches where it
 * appears as written, not inside a longer word. When two names could match at
 * the same place, the longer one wins, so "Mr. Darling" is never also counted
 * as "Darling".
 */

/**
 * Scripts in which a name runs straight into the text around it: no spaces
 * between words (Chinese, Japanese, Thai), or particles attached to the name
 * (Korean). Names in these scripts match wherever their characters appear.
 */
export const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Hangul}]/u

/**
 * Put text in one canonical form, so that the same name always compares
 * equal: composed accents, and straight quotes for typographic ones
 * ("O’Brien" and "O'Brien").
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
}

export function aliasKey(alias: string): string {
  return normalizeText(alias).trim().toLowerCase()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The spellings under which an alias may appear.
 *
 * A capitalised name must keep its capitals ("Hook" is not "hook"), but may
 * be set in all caps, as in a chapter heading. A lower-case term may also
 * open a sentence.
 */
function spellings(alias: string): string[] {
  const variants = new Set([alias, alias.toUpperCase()])
  if (alias === alias.toLowerCase()) {
    const [first = "", ...rest] = alias
    variants.add(first.toUpperCase() + rest.join(""))
  }
  return [...variants]
}

export interface AliasMatch<T> {
  value: T
  index: number
  length: number
}

export class AliasMatcher<T> {
  private readonly pattern: RegExp | null
  private readonly values = new Map<string, T>()

  constructor(entries: Iterable<readonly [alias: string, value: T]>) {
    for (const [alias, value] of entries) {
      for (const spelling of spellings(normalizeText(alias).trim())) {
        if (spelling && !this.values.has(spelling)) {
          this.values.set(spelling, value)
        }
      }
    }

    // Longest first, so the longest name wins at any position. The word
    // boundary checks are shared by the whole group, not repeated per name:
    // with thousands of names that is the difference between a pattern that
    // builds in milliseconds and one that takes seconds.
    const spelled = [...this.values.keys()].sort((a, b) => b.length - a.length)
    const group = (names: string[]) =>
      `(?:${names.map(escapeRegExp).join("|")})`
    const bounded = spelled.filter((name) => !UNSPACED_SCRIPT.test(name))
    const unbounded = spelled.filter((name) => UNSPACED_SCRIPT.test(name))

    const parts = [
      ...(bounded.length
        ? [`(?<![\\p{L}\\p{N}])${group(bounded)}(?![\\p{L}\\p{N}])`]
        : []),
      ...(unbounded.length ? [group(unbounded)] : []),
    ]
    this.pattern = parts.length ? new RegExp(parts.join("|"), "gu") : null
  }

  /** Every non-overlapping match in `text`, left to right. */
  find(text: string): AliasMatch<T>[] {
    if (!this.pattern) return []

    const matches: AliasMatch<T>[] = []
    for (const match of normalizeText(text).matchAll(this.pattern)) {
      // The pattern is built from the keys of `values`, so every match is one.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const value = this.values.get(match[0])!
      matches.push({ value, index: match.index, length: match[0].length })
    }
    return matches
  }
}
