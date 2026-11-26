import { skipToken } from "@reduxjs/toolkit/query"
import {
  MAX_SUBJECT_LENGTH,
  MAX_SUBJECT_PICKS,
  cleanSubject,
  subjectKey,
} from "@storyteller/web/src/recommendations/subjects"
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
import {
  subjectChoices,
  titleList,
  toggleSeriesLength,
  toggleSubject,
} from "@/store/recommendations"
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
const LENGTH_OPTIONS: readonly Option<SeriesLength | "any">[] = [
  ["any", "Any length"],
  ["short", "Short (2–4)"],
  ["medium", "Medium (5–9)"],
  ["long", "Long (10+)"],
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
  disabled?: boolean | ((value: Value) => boolean) | undefined
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
            className="max-w-full"
            disabled={
              typeof disabled === "function" ? disabled(value) : disabled
            }
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            onPress={() => choose(value)}
          >
            <Text className="shrink" numberOfLines={1}>
              {label}
            </Text>
          </Button>
        )
      })}
    </View>
  )
}

export function SeriesLengthChips({
  selected,
  onChange,
  disabled,
}: {
  selected: SeriesLength[]
  onChange: (lengths: SeriesLength[]) => void
  disabled: boolean
}) {
  return (
    <View className="gap-2">
      <Text>Series length (choose any that fit)</Text>
      <ChoiceChips
        options={LENGTH_OPTIONS}
        selected={selected.length ? selected : "any"}
        choose={(value) => onChange(toggleSeriesLength(selected, value))}
        disabled={disabled}
      />
    </View>
  )
}

export function SubjectPicker({
  profile,
  selected,
  other = [],
  onChange,
  inputLabel,
  disabled,
}: {
  profile: readonly string[]
  selected: string[]
  other?: readonly string[]
  onChange: (subjects: string[]) => void
  inputLabel: string
  disabled: boolean
}) {
  const [draft, setDraft] = useState("")
  const [custom, setCustom] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const subjects = subjectChoices(profile, [...selected, ...other, ...custom])
  const options = subjects.map((name) => [subjectKey(name), name] as const)
  const selectedKeys = selected.map(subjectKey)
  // The reader's own subjects and a few general ones first; the rest of the
  // general list behind "More subjects", so the screen stays short.
  const collapsedCount = Math.max(10, profile.length + 6)
  const shown = expanded
    ? options
    : options.filter(
        ([optionKey], index) =>
          index < collapsedCount || selectedKeys.includes(optionKey),
      )
  const hiddenCount = options.length - shown.length
  const atLimit = selected.length >= MAX_SUBJECT_PICKS
  const name = cleanSubject(draft)
  const key = subjectKey(name)
  const canAdd = !disabled && !atLimit && !!key && !selectedKeys.includes(key)

  function add() {
    if (!canAdd) return
    const existing = subjects.find((subject) => subjectKey(subject) === key)
    if (!existing) setCustom([...custom, name])
    onChange(toggleSubject(selected, existing ?? name))
    setDraft("")
  }

  return (
    <View className="gap-2">
      <ChoiceChips
        options={shown}
        selected={selectedKeys}
        choose={(value) => {
          const option = options.find(([optionKey]) => optionKey === value)
          if (option) onChange(toggleSubject(selected, option[1]))
        }}
        disabled={(value) =>
          disabled || (atLimit && !selectedKeys.includes(value))
        }
      />
      {(hiddenCount > 0 || expanded) && (
        <Button
          variant="ghost"
          className="self-start"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
        >
          <Text numberOfLines={1} className="text-primary">
            {expanded ? "Fewer subjects" : `More subjects (${hiddenCount})`}
          </Text>
        </Button>
      )}
      {atLimit && (
        <Text
          className="text-muted-foreground text-sm"
          accessibilityLiveRegion="polite"
        >
          Up to {MAX_SUBJECT_PICKS} subjects. Tap a selected subject to remove
          it.
        </Text>
      )}
      <View className="flex-row items-center gap-2">
        <Input
          className="min-w-0 flex-1"
          accessibilityLabel={inputLabel}
          placeholder="Add your own"
          value={draft}
          maxLength={MAX_SUBJECT_LENGTH}
          onChangeText={setDraft}
          onSubmitEditing={add}
          returnKeyType="done"
          editable={!disabled && !atLimit}
        />
        <Button variant="outline" disabled={!canAdd} onPress={add}>
          <Text numberOfLines={1}>Add</Text>
        </Button>
      </View>
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
  const [liked, setLiked] = useState("")
  const [asUsual, setAsUsual] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [start, { isLoading }] = serverApi.useStartRecommendationRoundMutation()

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
          <SeriesLengthChips
            selected={length}
            onChange={setLength}
            disabled={isLoading}
          />
        )}
      </View>
      <View className="gap-2">
        <Text variant="h4">Mood or subject</Text>
        <SubjectPicker
          profile={initial.subjects}
          selected={subjects}
          onChange={setSubjects}
          inputLabel="Add a custom mood or subject"
          disabled={isLoading}
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
