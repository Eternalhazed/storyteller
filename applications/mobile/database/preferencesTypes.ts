import { type HighlightTint } from "@/colors"
import { colors } from "@/components/ui/tokens/colors"

/** Built-in Home sections; server shelves use the id `shelf:<uuid>`. */
export const DEFAULT_HOME_SECTION_ORDER = [
  "continue",
  "jumpBackIn",
  "shortlist",
  "nextInSeries",
  "forYou",
  "nearlyDone",
  "startSeries",
  "newReadalouds",
  "toRead",
  "recentlyAdded",
  "magazines",
  "collections",
  "paused",
] as const

export type HomeSectionId = (typeof DEFAULT_HOME_SECTION_ORDER)[number]

export const defaultPreferences: Preferences = {
  darkMode: "auto",
  showReaderUi: false,
  colorThemes: [
    {
      name: "Day",
      foreground: colors.gray9,
      background: colors.white,
      isDark: false,
    },
    {
      name: "Sepia",
      foreground: colors.brown9,
      background: colors.yellow0,
      isDark: false,
    },
    {
      name: "Crisp White",
      foreground: colors.black,
      background: colors.white,
      isDark: false,
    },
    {
      name: "Night",
      foreground: colors.gray3,
      background: colors.gray9,
      isDark: true,
    },
  ],
  lightTheme: "Day",
  darkTheme: "Night",
  typography: {
    scale: 1.0,
    lineHeight: 1.4,
    alignment: "justify",
    fontFamily: "Literata",
  },
  layout: {
    margins: {
      vertical: 1.0,
      horizontal: 1.0,
    },
    marginLeft: 0,
    marginRight: 0,
    columns: "auto",
    animation: true,
    scroll: false,
  },
  floatingToolbar: false,
  readaloudColor: "yellow",
  readaloudDecoratorStyle: "highlight",
  highlightColor: "yellow",
  customFonts: [],
  automaticRewind: {
    enabled: true,
    afterInterruption: 3,
    afterBreak: 10,
  },
  hideStatusbar: {
    enabled: true,
  },
  logLevel: "info",
  finishPrompt: {
    mode: "ask",
    threshold: 0.95,
    autoStartReading: true,
  },
  shortlist: {
    removeWhen: "started",
  },
  home: {
    order: [...DEFAULT_HOME_SECTION_ORDER],
    hidden: ["collections"],
    coverSize: "medium",
  },
}

export type ColorTheme = {
  name: string
  foreground: string
  background: string
  isDark: boolean
}

type TypographyPreferences = {
  scale: number
  lineHeight: number
  alignment: "left" | "justify"
  fontFamily: string
}

type LayoutPreferences = {
  margins: {
    vertical: number
    horizontal: number
  }
  marginLeft?: number
  marginRight?: number
  columns: 1 | 2 | "auto"
  animation: boolean
  scroll?: boolean
}

type AudioPreferences = {
  speed: number
  readaloudSpeed: number
}

type AutomaticRewindPreferences = {
  enabled: boolean
  afterInterruption: number
  afterBreak: number
}

export type ReadaloudDecoratorStyle = "highlight" | "underline"

export interface BookPreferences {
  typography?: Partial<TypographyPreferences>
  layout?: Partial<LayoutPreferences>
  audio?: Partial<AudioPreferences>
  readaloudColor?: string
  readaloudDecoratorStyle?: ReadaloudDecoratorStyle
  detailView?: {
    mode: "audio" | "text"
    scope: "chapter" | "book"
  }
}

export type CustomFont = {
  filename: string
  name: string
  type: "ttf" | "otf"
}

export type HideStatusbarPreferences = {
  enabled: boolean
}

/**
 * When a book counts as finished, and what happens then. `threshold` is the
 * share of the book (0–1) after which the app treats it as finished.
 */
export type FinishPromptPreferences = {
  /** "ask" offers to mark it read, "automatic" marks it read with an undo. */
  mode: "ask" | "automatic" | "off"
  threshold: number
  /** Move a "To read" book to "Reading" once it has properly been started. */
  autoStartReading: boolean
}

export type ShortlistPreferences = {
  /** When a book leaves the Shortlist on its own. */
  removeWhen: "started" | "finished"
}

export type HomePreferences = {
  /** Section order; may also hold `shelf:<uuid>` ids for server shelves. */
  order: string[]
  /** Section ids the reader has hidden. */
  hidden: string[]
  coverSize: "small" | "medium" | "large"
}

export interface Preferences {
  darkMode: boolean | "auto"
  colorThemes: ColorTheme[]
  showReaderUi: boolean
  lightTheme: string
  darkTheme: string
  typography: TypographyPreferences
  layout: LayoutPreferences
  readaloudColor: string
  readaloudDecoratorStyle: ReadaloudDecoratorStyle
  highlightColor: HighlightTint
  customFonts: CustomFont[]
  hideStatusbar: HideStatusbarPreferences
  automaticRewind: AutomaticRewindPreferences
  logLevel: "debug" | "info" | "error"
  floatingToolbar: boolean
  finishPrompt: FinishPromptPreferences
  shortlist: ShortlistPreferences
  home: HomePreferences
}
