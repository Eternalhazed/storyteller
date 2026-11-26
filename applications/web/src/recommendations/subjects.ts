// Shared with the mobile subject picker; no server imports.
export const MAX_SUBJECT_LENGTH = 40
export const MAX_SUBJECT_PICKS = 12

export const GENERAL_SUBJECTS = [
  "Historical fiction",
  "Military history",
  "Naval adventure",
  "Science fiction",
  "Space opera",
  "Military science fiction",
  "Fantasy",
  "Epic fantasy",
  "Mystery",
  "Thriller",
  "Literary fiction",
  "Classics",
  "Biography",
  "Narrative non-fiction",
  "Humor",
  "Horror",
  "Romance",
  "Short books",
  "Long series",
  "Cozy",
  "Dark",
  "Hopeful",
  "Fast-paced",
  "Slow-burn",
  "Coming of age",
] as const

export function cleanSubject(subject: string): string {
  return subject.replace(/[\s\p{Cc}]+/gu, " ").trim()
}

export function subjectKey(subject: string): string {
  return cleanSubject(subject).toLowerCase()
}

/** First spelling wins, so specific profile subjects can precede broad defaults. */
export function uniqueSubjects(subjects: readonly string[]): string[] {
  const items = new Map<string, string>()
  for (const subject of subjects) {
    const name = cleanSubject(subject).slice(0, MAX_SUBJECT_LENGTH).trimEnd()
    const key = name.toLowerCase()
    if (key && !items.has(key)) items.set(key, name)
  }
  return [...items.values()]
}

export function withoutSubjects(
  subjects: string[],
  exclude: string[],
): string[] {
  const keys = new Set(exclude.map(subjectKey))
  return subjects.filter((subject) => !keys.has(subjectKey(subject)))
}
