import { readFile, rename, writeFile } from "node:fs/promises"
import { parseArgs } from "node:util"

import { DEFAULT_XRAY_MODEL, createAnthropicModel } from "./anthropic.ts"
import { readBookSource } from "./epub.ts"
import { type GenerationState, generateXray } from "./generate.ts"
import { xraySchema } from "./model.ts"
import { locateSentence, storySoFar, viewXray } from "./view.ts"

const USAGE = `Usage:
  xray generate <book.epub> --out <xray.json> [--model <id>] [--state <file>] [--max-segments <n>]
  xray show <xray.json> [--at <0-1>] [--top <n>]

generate reads ANTHROPIC_API_KEY from the environment. With --state, progress
is saved after every passage and an interrupted run picks up where it stopped.
--max-segments is for trying things out: it stops early and writes a file that
covers only the passages read.

show prints what a reader sees at a point in the book: --at 0.25 is a quarter
of the way through, and the default is the end.`

function print(line: string) {
  process.stdout.write(`${line}\n`)
}

async function generate(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      model: { type: "string", default: DEFAULT_XRAY_MODEL },
      state: { type: "string" },
      "max-segments": { type: "string" },
    },
  })
  const [epubPath] = positionals
  const apiKey = process.env["ANTHROPIC_API_KEY"]
  if (!epubPath || !values.out) throw new Error(USAGE)
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")

  const maxSegments =
    values["max-segments"] === undefined
      ? undefined
      : Number(values["max-segments"])
  if (
    maxSegments !== undefined &&
    !(Number.isInteger(maxSegments) && maxSegments > 0)
  ) {
    throw new Error("--max-segments must be a positive whole number")
  }

  let resume: GenerationState | undefined
  if (values.state) {
    try {
      resume = JSON.parse(
        await readFile(values.state, "utf-8"),
      ) as GenerationState
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }

  let rejected = 0
  const { xray, skippedSegments, inputTokens, outputTokens } =
    await generateXray(await readBookSource(epubPath), {
      model: values.model,
      callModel: createAnthropicModel({ apiKey, model: values.model }),
      ...(resume && { resume }),
      ...(maxSegments !== undefined && { maxSegments }),
      onCheckpoint: async (state) => {
        if (!values.state) return
        // Written beside the file and renamed, so an interrupted run never
        // leaves half a checkpoint behind.
        await writeFile(`${values.state}.tmp`, JSON.stringify(state))
        await rename(`${values.state}.tmp`, values.state)
      },
      onProgress: (progress) => {
        process.stderr.write(`\r${Math.round(progress * 100)}%`)
      },
      onRejection: (segmentIndex, note) => {
        rejected++
        process.stderr.write(`\n  passage ${segmentIndex + 1}: ${note}\n`)
      },
    })
  process.stderr.write("\n")

  await writeFile(values.out, JSON.stringify(xray))
  print(
    `${xray.entities.length} entities, ${xray.segments.length} passages, ` +
      `${inputTokens} tokens in, ${outputTokens} out, ${rejected} rejected, ${skippedSegments} passages skipped`,
  )
}

async function show(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      at: { type: "string", default: "1" },
      top: { type: "string", default: "25" },
    },
  })
  const [xrayPath] = positionals
  if (!xrayPath) throw new Error(USAGE)

  const xray = xraySchema.parse(JSON.parse(await readFile(xrayPath, "utf-8")))
  const sentenceCount = xray.chapters.reduce(
    (sum, chapter) => sum + chapter.lengths.length,
    0,
  )
  const boundary = Math.max(
    0,
    Math.round(Number(values.at) * sentenceCount) - 1,
  )
  const views = viewXray(xray, boundary)

  print(
    `At sentence ${boundary + 1} of ${sentenceCount}: ${views.length} entities known`,
  )
  for (const view of views.slice(0, Number(values.top))) {
    const others = view.aliases.filter((alias) => alias !== view.name)
    print(
      `\n${view.name} (${view.type}, ${view.mentions.length} mentions)` +
        (others.length ? `; also ${others.join(", ")}` : ""),
    )
    if (view.description) print(`  ${view.description}`)
    for (const fact of view.facts.slice(-4)) {
      const location = locateSentence(xray, fact.sentence)
      print(`  - ${fact.text} [${location?.fragment ?? fact.sentence}]`)
    }
  }

  const story = storySoFar(xray, boundary)
  print(`\nStory so far (${story.length} passages):`)
  for (const summary of story.slice(-3)) print(`  ${summary}`)
}

async function main([command, ...rest]: string[]) {
  if (command === "generate") await generate(rest)
  else if (command === "show") await show(rest)
  else throw new Error(USAGE)
}

// No top-level await: the package is also built as CommonJS.
main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
