// Kept free of server imports: the app reads these types too.

import { type ChosenWork } from "@/requests/types"
import { type UUID } from "@/uuid"

/**
 * Where a pick sits. `series`, `lists` and `discover` are the standing
 * sections; `asked` (after the interview or a wish) and `finished` (after a
 * finished book) sit on top until the next full round.
 */
export const SECTIONS = [
  "asked",
  "finished",
  "series",
  "lists",
  "discover",
] as const
export type Section = (typeof SECTIONS)[number]

export const SECTION_TITLES: Record<Section, string> = {
  asked: "For what you asked",
  finished: "Because you finished",
  series: "Missing from your series",
  lists: "From your lists",
  discover: "Discover",
}

/** Why a reader's queued wish or tune round stopped: they asked again. */
export const ROUND_REPLACED = "Replaced by a newer request"

export const PICK_STATES = [
  "new",
  "requested",
  "saved",
  "not_now",
  "not_for_me",
  "already_read",
  "not_found",
] as const
export type PickState = (typeof PICK_STATES)[number]

/** States a reader sets from the pick sheet. */
export const READER_PICK_STATES = [
  "new",
  "saved",
  "not_now",
  "not_for_me",
  "already_read",
  "not_found",
] as const satisfies readonly PickState[]
export type ReaderPickState = (typeof READER_PICK_STATES)[number]

export const NOT_FOR_ME_REASONS = [
  "not_my_thing",
  "too_long",
  "author",
  "other",
] as const
export type NotForMeReason = (typeof NOT_FOR_ME_REASONS)[number]

export type RoundTrigger =
  | "weekly"
  | "import"
  | "finished"
  | "tune"
  | "wish"
  | "refresh"
  | "first"

/** Full rounds fill every section; anchored rounds follow one finished book. */
export type RoundKind = "full" | "anchored"

export type RoundStatus = "running" | "done" | "failed"
export type RoundStage = "finding" | "verifying" | "ranking"

/** A fact about the reader that a reason cites. */
export type Evidence = { id: string; kind: string; text: string }

/** A recommended book, ready for the request picker. */
export type PickWork = ChosenWork & {
  /** Catalog key, e.g. `audible:B002V0KS9A`. */
  key: string
  coverUrl: string | null
  releaseDate: string | null
  runtimeMinutes: number | null
  pages: number | null
  narrators: string[]
  description: string | null
}

export type PickSeries = {
  name: string
  position: number | null
  /** Books in the main sequence so far; null when the catalog did not say. */
  books: number | null
  latestReleaseYear: number | null
}

export type PickView = {
  uuid: UUID
  roundUuid: UUID
  section: Section
  work: PickWork
  /** One line for cards. */
  reason: string
  /** A few sentences for the pick sheet. */
  why: string
  evidence: Evidence[]
  /** Set when the pick crosses a standing preference, e.g. "Shorter: 3 books". */
  label: string | null
  pill: "new" | "stretch" | null
  /** E.g. "Might be read on Kindle" or "Not found on Nov 30". */
  note: string | null
  series: PickSeries | null
  /** The finished book this pick follows, for the `finished` section. */
  anchorTitle: string | null
  state: PickState
  requestUuid: UUID | null
}

export type RoundView = {
  uuid: UUID
  trigger: RoundTrigger
  kind: RoundKind
  status: RoundStatus
  stage: RoundStage | null
  error: string | null
  /** ISO 8601, UTC. */
  createdAt: string
  finishedAt: string | null
}

export type SectionView = { section: Section; title: string; picks: PickView[] }

export type RecommendationsView = {
  /** The newest finished full round, if any. */
  round: RoundView | null
  /** A round still running for this reader, if any. */
  running: RoundView | null
  /** The newest round, when it failed and the reader asked for it. */
  failed: RoundView | null
  sections: SectionView[]
  /** Six to eight picks for the Home row, best first, mixed. */
  forYou: PickView[]
  saved: PickView[]
  /** Too little history: the app shows the interview instead of sections. */
  coldStart: boolean
  /** The monthly budget is spent; weekly picks wait until next month. */
  budgetPaused: boolean
  /** Manual refreshes left today. */
  refreshesLeft: number
}

export type RecommendationsConfig = {
  /** Recommendations and Ask work on this server (an AI key is set). */
  enabled: boolean
  /** Get can open the request picker (an acquisition adapter is set). */
  requestsEnabled: boolean
}

export type SeriesShape = "series" | "standalone" | "either"
export const SERIES_LENGTHS = ["short", "medium", "long"] as const
export type SeriesLength = (typeof SERIES_LENGTHS)[number]

/** Empty means any length. Also reads single values from older stored JSON. */
export function normalizeSeriesLengths(value: unknown): SeriesLength[] {
  const lengths = SERIES_LENGTHS.filter((length) =>
    Array.isArray(value) ? value.includes(length) : value === length,
  )
  return lengths.length === SERIES_LENGTHS.length ? [] : lengths
}
export type FormatPreference = "read" | "listen" | "readalong" | "any"

export type RecommendationPreferences = {
  seriesShape: SeriesShape
  seriesLength: SeriesLength[]
  format: FormatPreference
  favorSubjects: string[]
  avoidSubjects: string[]
  /** Off: rounds use only Storyteller data, in-app entries and answers. */
  useHistory: boolean
  notifyNewInSeries: boolean
  notifyNewPicks: boolean
}

export const DEFAULT_PREFERENCES: RecommendationPreferences = {
  seriesShape: "either",
  seriesLength: [],
  format: "any",
  favorSubjects: [],
  avoidSubjects: [],
  useHistory: true,
  notifyNewInSeries: true,
  notifyNewPicks: false,
}

export type InterviewGoal = "continue" | "new" | "like" | "surprise"

/** The interview's questions, preselected from the profile and preferences. */
export type InterviewView = {
  coldStart: boolean
  goal: InterviewGoal | null
  seriesShape: SeriesShape
  seriesLength: SeriesLength[]
  /** Top subjects from the reader's own profile, even with little history. */
  subjects: string[]
  /** Asked only when the reader both reads and listens. */
  askFormat: boolean
  format: FormatPreference
}

export type InterviewAnswers = {
  goal?: InterviewGoal | null
  /** Titles for "Like a book I loved…" and the cold-start question. */
  likedBooks?: string[]
  seriesShape?: SeriesShape
  seriesLength?: SeriesLength[]
  subjects?: string[]
  /** Additional subjects to exclude for a wish interpreted by the reading helper. */
  avoidSubjects?: string[]
  freeText?: string | null
  format?: FormatPreference
  /** Write these answers to standing preferences. */
  saveAsUsual?: boolean
}

export type StartRoundInput = {
  answers?: InterviewAnswers
  wish?: string
  anchorBookUuid?: UUID
  refresh?: boolean
}

/** What is already true about a book the reader named in Ask. */
export type AskCardState = "on_shelf" | "to_read" | "household" | "get"

export type AskCard = {
  work: PickWork
  series: PickSeries | null
  state: AskCardState
  /** The reader's library book (on_shelf, to_read) or the household copy. */
  bookUuid: UUID | null
}

export type AskQuestion = {
  /** The text as the reader typed it. */
  asked: string
  /** Two to four named choices. */
  choices: AskCard[]
}

export type AskResult =
  | {
      intent: "get"
      cards: AskCard[]
      questions: AskQuestion[]
      /** Titles the catalog does not know, as typed. */
      notFound: string[]
    }
  | {
      intent: "next"
      round: RoundView | null
      /** The finished book in the reader's library, to offer Mark as read. */
      anchor: {
        bookUuid: UUID | null
        title: string
        read: boolean
      }
    }
  | { intent: "wish"; round: RoundView }
  | { intent: "unclear"; message: string }

export type PickOutcome =
  | "requested"
  | "finished"
  | "rated"
  | "turned_down"
  | "not_found"
  | "saved"
  | null

export type EarlierRoundView = RoundView & {
  picks: (PickView & { outcome: PickOutcome; rating: number | null })[]
}

export type SectionStats = {
  section: Section
  shown: number
  requested: number
  finished: number
  ratedHigh: number
  notForMe: number
}

export type RecommendationHistoryView = {
  rounds: EarlierRoundView[]
  stats: SectionStats[]
}
