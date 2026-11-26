import { z } from "zod"

import {
  MAX_SUBJECT_LENGTH,
  MAX_SUBJECT_PICKS,
  cleanSubject,
  uniqueSubjects,
} from "./subjects"
import { SERIES_LENGTHS, normalizeSeriesLengths } from "./types"

export const SeriesLengthsSchema = z
  .array(z.enum(SERIES_LENGTHS))
  .max(SERIES_LENGTHS.length)
  .transform(normalizeSeriesLengths)

export const SubjectListSchema = z
  .array(
    z
      .string()
      .transform(cleanSubject)
      .pipe(z.string().min(1).max(MAX_SUBJECT_LENGTH)),
  )
  .max(MAX_SUBJECT_PICKS)
  .transform(uniqueSubjects)
