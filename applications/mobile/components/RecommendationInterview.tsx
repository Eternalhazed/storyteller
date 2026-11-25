import { skipToken } from "@reduxjs/toolkit/query"
import {
  type FormatPreference,
  type InterviewAnswers,
  type InterviewGoal,
  type InterviewView,
  type SeriesLength,
  type SeriesShape,
} from "@storyteller/web/src/recommendations/types"
import { useState } from "react"
import { View } from "react-native"

import { requestErrorMessage } from "@/store/requestErrors"
import { titleList } from "@/store/recommendations"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

import { RequestError } from "./RequestPage"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Switch } from "./ui/switch"
import { Text } from "./ui/text"

type Option<Value extends string> = readonly [Value, string]

export const SERIES_SHAPES: readonly Option<SeriesShape>[] = [
  ["series", "Series"],
  ["standalone", "Standalone"],
  ["either", "Either"],
]
export const SERIES_LENGTHS: readonly Option<SeriesLength>[] = [
  ["short", "Short (2–4)"],
  ["medium", "Medium (5–9)"],
  ["long", "Long (10+)"],
  ["any", "Any"],
]
export const FORMATS: readonly Option<FormatPreference>[] = [
  ["read", "Read"],
  ["listen", "Listen"],
  ["readalong", "Read-along"],
  ["any", "Any"],
]
const GOALS: readonly Option<InterviewGoal>[] = [
  ["continue", "Continue a series"],
  ["new", "Something new"],
  ["like", "Like a book I loved…"],
  ["surprise", "Surprise me"],
]

export function ChoiceChips<Value extends string>({
  options,
  selected,
  choose,
  disabled,
}: {
  options: readonly Option<Value>[]
  selected: Value | readonly Value[] | null
  choose: (value: Value) => void
  disabled?: boolean | undefined
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map(([value, label]) => {
        const active =
          typeof selected === "string"
            ? selected === value
            : !!selected?.includes(value)
        return (
          <Button
            key={value}
            variant={active ? "default" : "outline"}
            size="flex"
            disabled={disabled}
            accessibilityState={{ selected: active }}
            onPress={() => choose(value)}
          >
            <Text>{label}</Text>
          </Button>
        )
      })}
    </View>
  )
}

export function RecommendationToggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean | undefined
}) {
  return (
    <View className="flex-row items-center justify-between gap-3 py-1">
      <Text className="flex-1">{label}</Text>
      <Switch
        accessibilityLabel={label}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </View>
  )
}

function InterviewForm({
  initial,
  serverUuid,
  onStarted,
}: {
  initial: InterviewView
  serverUuid: UUID
  onStarted: () => void
}) {
  const [goal, setGoal] = useState(initial.goal)
  const [shape, setShape] = useState(initial.seriesShape)
  const [length, setLength] = useState(initial.seriesLength)
  const [format, setFormat] = useState(initial.format)
  const [subjects, setSubjects] = useState<string[]>([])
  const [freeText, setFreeText] = useState("")
  const [liked, setLiked] = useState("")
  const [asUsual, setAsUsual] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [start, { isLoading }] = serverApi.useStartRecommendationRoundMutation()
  const subjectOptions = [
    ...new Set([...initial.subjects, "Something new"]),
  ].map((subject) => [subject, subject] as const)

  function toggleSubject(subject: string) {
    setSubjects((previous) =>
      previous.includes(subject)
        ? previous.filter((value) => value !== subject)
        : [...previous, subject],
    )
  }

  async function submit(skip: boolean) {
    setError(null)
    const answers: InterviewAnswers = skip
      ? {}
      : {
          ...(!initial.coldStart ? { goal } : {}),
          ...(initial.coldStart || goal === "like"
            ? { likedBooks: titleList(liked) }
            : {}),
          seriesShape: shape,
          seriesLength: length,
          subjects,
          freeText: freeText.trim() || null,
          ...(initial.askFormat ? { format } : {}),
          saveAsUsual: asUsual,
        }
    try {
      await start({ serverUuid, answers }).unwrap()
      onStarted()
    } catch (cause) {
      setError(
        requestErrorMessage(cause, "Could not start your picks. Try again."),
      )
    }
  }

  return (
    <View className="gap-5">
      <View className="gap-2">
        <Text variant="h4">
          {initial.coldStart
            ? "Name two or three books you loved"
            : "What are you after?"}
        </Text>
        {!initial.coldStart && (
          <ChoiceChips
            options={GOALS}
            selected={goal}
            choose={setGoal}
            disabled={isLoading}
          />
        )}
        {(initial.coldStart || goal === "like") && (
          <Input
            multiline
            accessibilityLabel="Books you loved"
            placeholder="One title per line"
            value={liked}
            onChangeText={setLiked}
            editable={!isLoading}
          />
        )}
      </View>
      <View className="gap-2">
        <Text variant="h4">Series or standalone?</Text>
        <ChoiceChips
          options={SERIES_SHAPES}
          selected={shape}
          choose={setShape}
          disabled={isLoading}
        />
        {shape !== "standalone" && (
          <>
            <Text>Series length</Text>
            <ChoiceChips
              options={SERIES_LENGTHS}
              selected={length}
              choose={setLength}
              disabled={isLoading}
            />
          </>
        )}
      </View>
      <View className="gap-2">
        <Text variant="h4">Mood or subject</Text>
        <ChoiceChips
          options={subjectOptions}
          selected={subjects}
          choose={toggleSubject}
          disabled={isLoading}
        />
        <Input
          accessibilityLabel="Other subjects"
          placeholder="Anything else you’re in the mood for"
          value={freeText}
          onChangeText={setFreeText}
          editable={!isLoading}
        />
      </View>
      {initial.askFormat && (
        <View className="gap-2">
          <Text variant="h4">Read, listen or read-along?</Text>
          <ChoiceChips
            options={FORMATS}
            selected={format}
            choose={setFormat}
            disabled={isLoading}
          />
        </View>
      )}
      <RecommendationToggle
        label="Use these as my usual"
        checked={asUsual}
        onChange={setAsUsual}
        disabled={isLoading}
      />
      {error && <RequestError>{error}</RequestError>}
      <View className="flex-row flex-wrap gap-2">
        <Button disabled={isLoading} onPress={() => void submit(false)}>
          <Text numberOfLines={1}>
            {isLoading ? "Starting…" : "Find my picks"}
          </Text>
        </Button>
        <Button
          variant="outline"
          disabled={isLoading}
          onPress={() => void submit(true)}
        >
          <Text numberOfLines={1}>Just pick for me</Text>
        </Button>
      </View>
    </View>
  )
}

export function RecommendationInterview({
  serverUuid,
  onStarted,
}: {
  serverUuid: UUID | undefined
  onStarted: () => void
}) {
  const query = serverApi.useGetRecommendationInterviewQuery(
    serverUuid ? { serverUuid } : skipToken,
    { refetchOnMountOrArgChange: true },
  )
  if (!serverUuid)
    return <Text>Recommendations aren’t available on this account.</Text>
  if (query.isError)
    return (
      <View className="items-start gap-2">
        <RequestError>Could not load the interview.</RequestError>
        <Button variant="outline" onPress={() => query.refetch()}>
          <Text>Try again</Text>
        </Button>
      </View>
    )
  if (!query.currentData) return <Text>Loading…</Text>
  return (
    <InterviewForm
      key={serverUuid}
      initial={query.currentData}
      serverUuid={serverUuid}
      onStarted={onStarted}
    />
  )
}
