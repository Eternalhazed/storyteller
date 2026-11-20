import { z } from "zod"

import { XRAY_SCHEMA_VERSION } from "./version.ts"

export { XRAY_GENERATOR_VERSION, XRAY_SCHEMA_VERSION } from "./version.ts"

export const xrayEntityTypes = ["character", "place", "group", "thing"] as const

export type XrayEntityType = (typeof xrayEntityTypes)[number]

/**
 * A piece of text that becomes visible once the reader reaches sentence `at`.
 *
 * `at` is an ordinal: the zero-based number of a sentence counted across the
 * whole book in reading order.
 */
const stampedSchema = z.object({
  text: z.string(),
  at: z.number().int().nonnegative(),
})

/**
 * Something notable the text establishes about an entity.
 *
 * `sentence` is the sentence that states it, and where a reader is taken to
 * see it. `at` is the end of the passage it was written from: the wording was
 * chosen with the whole passage in view, so it is shown only once the reader
 * has finished that passage.
 */
const factSchema = stampedSchema.extend({
  sentence: z.number().int().nonnegative(),
})

const entitySchema = z.object({
  id: z.number().int().nonnegative(),
  type: z.enum(xrayEntityTypes),
  /** Display names over time; the latest visible one is shown. */
  names: z.array(stampedSchema),
  /**
   * Every literal string that refers to this entity in the text, stamped
   * with the point at which a reader can know it does.
   */
  aliases: z.array(stampedSchema),
  /** Summaries over time, each stamped with the end of the passage read. */
  descriptions: z.array(stampedSchema),
  facts: z.array(factSchema),
  /**
   * Every sentence that names this entity, as `[ordinal, aliasIndex]`,
   * ascending by ordinal. `aliasIndex` points into `aliases`.
   */
  mentions: z.array(
    z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  ),
})

const chapterSchema = z.object({
  /** The spine item's manifest id; sentence `n` is span `{id}-s{n}`. */
  id: z.string(),
  href: z.string(),
  /** Ordinal of this chapter's first sentence. */
  start: z.number().int().nonnegative(),
  /**
   * Length of each sentence, in order, in characters other than whitespace.
   * A reading system that can count the same way knows exactly which
   * sentence a point in the chapter's text falls in.
   */
  lengths: z.array(z.number().int().nonnegative()),
})

const segmentSchema = z.object({
  /** Ordinal of the passage's first sentence. */
  start: z.number().int().nonnegative(),
  /** Ordinal just past the passage's last sentence. */
  end: z.number().int().nonnegative(),
  /** What happens in the passage; visible once the reader finishes it. */
  summary: z.string().nullable(),
})

export const xraySchema = z.object({
  schemaVersion: z.literal(XRAY_SCHEMA_VERSION),
  generator: z.object({
    version: z.number().int(),
    model: z.string(),
  }),
  source: z.object({
    /** SHA-256 of the EPUB the sentences were read from. */
    sha256: z.string(),
  }),
  chapters: z.array(chapterSchema),
  segments: z.array(segmentSchema),
  entities: z.array(entitySchema),
  /** Text of every sentence cited by a mention or fact, keyed by ordinal. */
  sentences: z.record(z.string(), z.string()),
})

export type XrayStamped = z.infer<typeof stampedSchema>
export type XrayFact = z.infer<typeof factSchema>
export type XrayEntity = z.infer<typeof entitySchema>
export type XrayChapter = z.infer<typeof chapterSchema>
export type XraySegment = z.infer<typeof segmentSchema>
export type Xray = z.infer<typeof xraySchema>
