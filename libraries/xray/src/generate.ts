import { AliasMatcher, normalizeText } from "./matcher.ts"
import {
  XRAY_GENERATOR_VERSION,
  XRAY_SCHEMA_VERSION,
  type Xray,
  type XrayEntity,
} from "./model.ts"
import { SYSTEM_PROMPT, buildPassagePrompt } from "./prompt.ts"
import {
  type DraftEntity,
  applySegmentOutput,
  segmentOutputSchema,
} from "./registry.ts"
import {
  type BookSource,
  type BookText,
  MIN_SEGMENT_TOKENS,
  type SegmentRange,
  estimateTokens,
  flattenBook,
  segmentBook,
} from "./segments.ts"
import { stampEntities } from "./stamp.ts"

export interface ModelRequest {
  system: string
  user: string
}

export interface ModelResponse {
  /** The model's answer, to be checked against `segmentOutputSchema`. */
  output: unknown
  inputTokens: number
  outputTokens: number
}

export type CallModel = (request: ModelRequest) => Promise<ModelResponse>

/**
 * Thrown by a `CallModel` when the model will not give a usable answer for a
 * passage however often it is asked: the answer is cut off or declined.
 *
 * `generateXray` skips such a passage and reads on, because retrying it would
 * fail the same way and stop the book from ever being finished. Any other
 * error (network, rate limit, bad key) stops the run so it can be resumed.
 */
export class UnansweredError extends Error {
  override name = "UnansweredError"

  constructor(
    message: string,
    readonly inputTokens = 0,
    readonly outputTokens = 0,
  ) {
    super(message)
  }
}

/**
 * Everything needed to continue an interrupted run without paying to reread
 * the passages already done.
 */
export interface GenerationState {
  /** SHA-256 of the EPUB this state belongs to. */
  sha256: string
  /**
   * Fingerprint of how the book was numbered and cut up. Every ordinal saved
   * here depends on it, so progress is only reused when it matches.
   */
  layout: string
  nextSegment: number
  entities: DraftEntity[]
  summaries: (string | null)[]
  /** Indexes of passages the model could not answer. */
  skipped: number[]
  inputTokens: number
  outputTokens: number
}

export interface GenerateOptions {
  /** The model's name, recorded in the file. */
  model: string
  callModel: CallModel
  /** Upper bound on the estimated size of one passage. */
  maxSegmentTokens?: number
  /** Stop after this many passages. The file then covers a partial read. */
  maxSegments?: number
  resume?: GenerationState
  onCheckpoint?: (state: GenerationState) => void | Promise<void>
  onProgress?: (progress: number) => void
  /** Called with a note for everything the model said that was rejected. */
  onRejection?: (segmentIndex: number, note: string) => void
}

export interface GenerateResult {
  xray: Xray
  /** How many passages were left out because the model could not answer. */
  skippedSegments: number
  inputTokens: number
  outputTokens: number
}

/** The message of the error thrown when saved progress cannot be reused. */
export const STALE_STATE_MESSAGE =
  "Saved progress belongs to a different book or version"

/** A short, stable fingerprint of a string (FNV-1a). */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/** Ids of the known entities named anywhere in the passage. */
function findActive(
  entities: readonly DraftEntity[],
  segment: SegmentRange,
  sentences: readonly string[],
): Set<number> {
  const matcher = new AliasMatcher(
    entities.flatMap((entity) =>
      entity.aliases.map((alias) => [alias.text, entity.id] as const),
    ),
  )
  const active = new Set<number>()
  for (let ordinal = segment.start; ordinal < segment.end; ordinal++) {
    for (const match of matcher.find(sentences[ordinal] ?? "")) {
      active.add(match.value)
    }
  }
  return active
}

/** A capital here can belong to the sentence or speech, rather than the name. */
function atUtteranceStart(text: string, index: number): boolean {
  const before = text.slice(0, index)
  return (
    !/[\p{L}\p{N}]/u.test(before) ||
    /(?:[—–:]|(?:^|[\s\p{P}])["'])\s*$/u.test(before)
  )
}

/**
 * Turn what was recorded while reading into the entities of the file: decide
 * when each item may be seen, find every sentence that names an entity, and
 * gather the text of every sentence the file cites.
 *
 * `sentences` maps ordinals to the whole book's text, so ordinary lowercase
 * words can be distinguished from names.
 */
export function buildIndex(
  drafts: readonly DraftEntity[],
  segments: readonly SegmentRange[],
  sentences: ReadonlyMap<number, string>,
): Pick<Xray, "entities" | "sentences"> {
  const entities: XrayEntity[] = stampEntities(drafts, segments).map(
    (entity) => ({ ...entity, mentions: [] }),
  )

  // The book itself tells us which names are also ordinary words. A name
  // such as "Hook" can have a lowercase use without usually being that word.
  const lowercaseUses = new Map<string, number>()
  const nameUses = new Map<string, number>()
  for (const sentence of sentences.values()) {
    const text = normalizeText(sentence)
    for (const match of text.matchAll(
      /[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu,
    )) {
      const word = match[0]
      const key = word.toLowerCase()
      if (word === key && word !== word.toUpperCase()) {
        lowercaseUses.set(key, (lowercaseUses.get(key) ?? 0) + 1)
      } else if (
        /^\p{Lu}/u.test(word) &&
        !atUtteranceStart(text, match.index)
      ) {
        nameUses.set(key, (nameUses.get(key) ?? 0) + 1)
      }
    }
  }
  const commonWords = new Set(
    [...lowercaseUses]
      .filter(([word, count]) => count >= (nameUses.get(word) ?? 0))
      .map(([word]) => word),
  )
  const matcher = new AliasMatcher(
    entities.flatMap((entity) =>
      entity.aliases.map((alias, aliasIndex) => {
        const name = normalizeText(alias.text).trim()
        return [
          name,
          {
            entity,
            aliasIndex,
            commonWord:
              /^\p{Lu}[\p{L}\p{M}\p{N}]*(?:'[\p{L}\p{M}\p{N}]+)*$/u.test(
                name,
              ) && commonWords.has(name.toLowerCase()),
          },
        ] as const
      }),
    ),
  )

  // Sentences are quoted to the reader, so they are tidied for display: an
  // EPUB's source is full of line breaks and indentation inside sentences.
  const tidy = (sentence: string) => sentence.replace(/\s+/gu, " ").trim()

  const cited: Record<string, string> = {}
  for (const [ordinal, sentence] of [...sentences].sort(([a], [b]) => a - b)) {
    const text = normalizeText(sentence)
    for (const { value, index } of matcher.find(text)) {
      if (value.commonWord && atUtteranceStart(text, index)) continue
      const { entity, aliasIndex } = value
      const last = entity.mentions.at(-1)
      if (last?.[0] !== ordinal) {
        entity.mentions.push([ordinal, aliasIndex])
        cited[ordinal] = tidy(sentence)
      } else if (
        // A sentence that uses two of an entity's names counts as a mention
        // as soon as the reader knows either of them.
        (entity.aliases[aliasIndex]?.at ?? Infinity) <
        (entity.aliases[last[1]]?.at ?? Infinity)
      ) {
        last[1] = aliasIndex
      }
    }
  }

  for (const entity of entities) {
    for (const fact of entity.facts) {
      cited[fact.sentence] = tidy(sentences.get(fact.sentence) ?? "")
    }
  }

  return { entities, sentences: cited }
}

/**
 * Read a book passage by passage and build its X-Ray file.
 *
 * The model sees the book strictly in reading order and never sees a passage
 * before it has reported on the one before, so nothing it writes about a
 * passage can draw on later text.
 */
export async function generateXray(
  source: BookSource,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const { sha256 } = source
  const book: BookText = flattenBook(source.chapters)
  const segments = segmentBook(book, {
    ...(options.maxSegmentTokens && { maxTokens: options.maxSegmentTokens }),
  })
  const layout = fingerprint(
    JSON.stringify([XRAY_GENERATOR_VERSION, book.chapters, segments]),
  )

  if (
    options.resume &&
    (options.resume.sha256 !== sha256 || options.resume.layout !== layout)
  ) {
    throw new Error(STALE_STATE_MESSAGE)
  }

  const state: GenerationState = options.resume ?? {
    sha256,
    layout,
    nextSegment: 0,
    entities: [],
    summaries: [],
    skipped: [],
    inputTokens: 0,
    outputTokens: 0,
  }

  const stopAt = Math.min(
    segments.length,
    options.maxSegments ?? segments.length,
  )

  while (state.nextSegment < stopAt) {
    const index = state.nextSegment
    // `index` is below `segments.length`.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const segment = segments[index]!
    options.onProgress?.(index / segments.length)

    const size = book.sentences
      .slice(segment.start, segment.end)
      .reduce((sum, sentence) => sum + estimateTokens(sentence), 0)

    let summary: string | null = null
    if (size >= MIN_SEGMENT_TOKENS) {
      const active = findActive(state.entities, segment, book.sentences)
      for (const entity of state.entities) {
        if (active.has(entity.id)) entity.lastSeen = index
      }

      try {
        const response = await options.callModel({
          system: SYSTEM_PROMPT,
          user: buildPassagePrompt(
            state.entities,
            active,
            segment,
            book.sentences,
          ),
        })
        state.inputTokens += response.inputTokens
        state.outputTokens += response.outputTokens

        const output = segmentOutputSchema.parse(response.output)
        const rejections = applySegmentOutput(
          state.entities,
          output,
          segment,
          index,
          book.sentences,
        )
        for (const note of rejections) options.onRejection?.(index, note)
        summary = output.summary.trim() || null
      } catch (error) {
        if (!(error instanceof UnansweredError)) throw error
        state.inputTokens += error.inputTokens
        state.outputTokens += error.outputTokens
        state.skipped.push(index)
        options.onRejection?.(index, `passage skipped: ${error.message}`)
      }
    }

    state.summaries.push(summary)
    state.nextSegment = index + 1
    await options.onCheckpoint?.(state)
  }

  options.onProgress?.(state.nextSegment / segments.length)

  return {
    xray: {
      schemaVersion: XRAY_SCHEMA_VERSION,
      generator: { version: XRAY_GENERATOR_VERSION, model: options.model },
      source: { sha256 },
      chapters: book.chapters,
      segments: segments.map((segment, index) => ({
        ...segment,
        summary: state.summaries[index] ?? null,
      })),
      ...buildIndex(
        state.entities,
        segments,
        new Map(book.sentences.entries()),
      ),
    },
    skippedSegments: state.skipped.length,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
  }
}
