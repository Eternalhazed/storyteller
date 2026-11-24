import { type ChosenWork, type Release, type RequestFormat } from "./types"

/** Shown next to a release so the reader knows what they are picking. */
export type ReleaseFlag =
  | "abridged"
  | "dramatized"
  | "pack"
  | "few-seeders"
  | "narrator-unverified"
  | "title-differs"

export type RankedRelease = Release & {
  flags: ReleaseFlag[]
  /** Why it can never be recommended, or null. Still listed when set. */
  excluded: string | null
}

export type RankingContext = {
  work: ChosenWork
  /** Narrators of the reader's other books in this series, if any. */
  editionNarrators: string[]
}

export type Recommendation = {
  ebook: RankedRelease | null
  audio: RankedRelease | null
  /** Built from the rules that decided it, most important first. */
  reasons: string[]
}

/** Seeders below this are flagged; zero never reaches the reader. */
const FEW_SEEDERS = 3

/** Audio this thin or thinner is not worth listening to. */
const MIN_BITRATE_KBPS = 32

/** Compares titles and names: case, accents, apostrophes and punctuation aside. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function namesMatch(a: string, b: string): boolean {
  return normalize(a) === normalize(b)
}

/** The release names the confirmed work, or one of its other titles. */
function matchesWork(release: Release, work: ChosenWork): boolean {
  const title = normalize(release.title)
  return [work.title, ...(work.altTitles ?? [])].some((name) => {
    const wanted = normalize(name)
    return !!wanted && title.includes(wanted)
  })
}

function hasFileType(release: Release, type: string): boolean | null {
  const types = release.facts.fileTypes?.value
  if (types) return types.some((each) => each.toLowerCase() === type)
  const files = release.files
  if (files) {
    return files.some((file) => file.path.toLowerCase().endsWith(`.${type}`))
  }
  return null
}

function narratorMatches(release: Release, narrators: string[]): boolean {
  // Only a structured field can certify a narrator.
  const fact = release.facts.narrators
  if (fact?.source !== "field") return false
  return fact.value.some((name) =>
    narrators.some((wanted) => namesMatch(name, wanted)),
  )
}

function isSingleM4b(release: Release): boolean {
  if (hasFileType(release, "m4b") !== true) return false
  const audioFiles = release.files?.filter((file) =>
    /\.(m4b|m4a|mp3|mp4|aac|ogg|opus|flac)$/i.test(file.path),
  )
  return audioFiles ? audioFiles.length === 1 : true
}

function annotate(release: Release, context: RankingContext): RankedRelease {
  const flags: ReleaseFlag[] = []
  let excluded: string | null = null
  const { facts } = release

  if (facts.abridged?.value) flags.push("abridged")
  if (facts.dramatized?.value) flags.push("dramatized")
  if (facts.pack?.value) {
    flags.push("pack")
    excluded = "Contains more than one book"
  }
  if (release.seeders < FEW_SEEDERS) flags.push("few-seeders")
  if (release.kind === "audio" && facts.narrators?.source !== "field") {
    flags.push("narrator-unverified")
  }
  if (!matchesWork(release, context.work)) flags.push("title-differs")

  if (release.kind === "ebook" && hasFileType(release, "epub") === false) {
    excluded = "No EPUB file"
  }
  if (
    release.kind === "audio" &&
    facts.bitrateKbps &&
    facts.bitrateKbps.value <= MIN_BITRATE_KBPS
  ) {
    excluded = `Audio at ${facts.bitrateKbps.value} kbps`
  }
  // Both are BCP 47 tags; "en" and "en-GB" are the same language here.
  const primary = (tag: string) => tag.toLowerCase().split(/[-_]/)[0]
  const language = context.work.language
  if (
    language &&
    facts.language &&
    primary(facts.language.value) !== primary(language)
  ) {
    excluded = `In another language (${facts.language.value})`
  }

  return { ...release, flags, excluded }
}

/**
 * Comparison by the recommendation rules, most important first: the
 * reader's edition (narrator), unabridged, a single chaptered M4B over loose
 * files, more seeders. Equal releases keep the adapter's order, which puts
 * its preferred source first.
 */
function compare(
  a: RankedRelease,
  b: RankedRelease,
  context: RankingContext,
): number {
  const rules: ((release: RankedRelease) => number)[] = [
    (release) => (release.excluded ? 0 : 1),
    (release) => (release.flags.includes("title-differs") ? 0 : 1),
    (release) => (narratorMatches(release, context.editionNarrators) ? 1 : 0),
    // unabridged when known, then unknown, then abridged
    (release) =>
      release.facts.abridged === null
        ? 1
        : release.facts.abridged.value
          ? 0
          : 2,
    (release) => (isSingleM4b(release) ? 1 : 0),
    (release) => release.seeders,
  ]
  for (const rule of rules) {
    const difference = rule(b) - rule(a)
    if (difference) return difference
  }
  return 0
}

/**
 * The releases a reader may pick from, best first. Releases nobody shares
 * are dropped; excluded ones stay listed, flagged, at the end.
 */
export function rankReleases(
  releases: Release[],
  kind: RequestFormat,
  context: RankingContext,
): RankedRelease[] {
  return releases
    .filter((release) => release.kind === kind && release.seeders > 0)
    .map((release) => annotate(release, context))
    .toSorted((a, b) => compare(a, b, context))
}

function recommendable(ranked: RankedRelease[]): RankedRelease | null {
  const [best] = ranked
  if (!best || best.excluded || best.flags.includes("title-differs")) {
    return null
  }
  return best
}

/** One recommended ebook and audiobook, and the reason line for them. */
export function recommendPair(
  ebooks: RankedRelease[],
  audios: RankedRelease[],
  context: RankingContext,
): Recommendation {
  const ebook = recommendable(ebooks)
  const audio = recommendable(audios)
  const reasons: string[] = []

  if (audio) {
    if (narratorMatches(audio, context.editionNarrators)) {
      reasons.push("Same narrator as your other books in this series")
    } else if (audio.flags.includes("narrator-unverified")) {
      reasons.push("Narrator not verified")
    }
    if (audio.facts.abridged?.value === false) reasons.push("Unabridged")
    if (isSingleM4b(audio)) reasons.push("One chaptered file")
    reasons.push(`${audio.seeders} seeders`)
    if (audio.flags.includes("few-seeders")) reasons.push("few seeders")
  }
  if (ebook && (!audio || ebook.flags.includes("few-seeders"))) {
    reasons.push(`Ebook: ${ebook.seeders} seeders`)
  }

  return { ebook, audio, reasons }
}
