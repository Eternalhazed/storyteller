import {
  type HelperMessage,
  type HelperTurn,
} from "@storyteller/web/src/recommendations/helper"
import {
  type AskCard,
  type AskResult,
} from "@storyteller/web/src/recommendations/types"

const STATE: Record<AskCard["state"], string> = {
  on_shelf: "on their shelf",
  to_read: "on their To read",
  household: "in the library",
  get: "can be requested",
}

function describeCard({ work, series, state }: AskCard): string {
  const author = work.authors[0]
  const place = series ?? work.series
  return [
    work.title,
    author && ` by ${author}`,
    place && ` (${place.name}${place.position ? ` #${place.position}` : ""})`,
    `, ${STATE[state]}`,
  ]
    .filter(Boolean)
    .join("")
}

/** What the reader saw under a helper reply, in words the model can use. */
function shown(result: AskResult | null): string | null {
  switch (result?.intent) {
    case "get":
      return [
        ...result.cards.map(describeCard),
        ...result.questions.map(
          (question) =>
            `asked which "${question.asked}": ${question.choices.map(describeCard).join("; ")}`,
        ),
        ...result.notFound.map((title) => `not found: ${title}`),
      ].join("; ")
    case "next":
      return `picks for what to read after ${result.anchor.title}`
    case "wish":
      return "picks for this request"
    default:
      return null
  }
}

/**
 * A helper turn as the conversation history sends it back: the reply plus
 * the cards the reader saw, so a follow-up ("the second one in that
 * series") has the titles and authors to work from.
 */
export function helperHistoryText(turn: HelperTurn): string {
  const note = shown(turn.result)
  const text = note ? `${turn.reply}\n[Shown: ${note}]` : turn.reply
  return text.slice(0, 1000)
}

type Entry =
  | { role: "reader"; text: string }
  | { role: "helper"; text: string; turn: HelperTurn }

/** The last twenty entries, ready to send. */
export function helperHistory(entries: Entry[]): HelperMessage[] {
  return entries
    .slice(-20)
    .map((entry) =>
      entry.role === "helper"
        ? { role: "helper", text: helperHistoryText(entry.turn) }
        : { role: "reader", text: entry.text },
    )
}
