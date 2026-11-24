import { type FetchBaseQueryError } from "@reduxjs/toolkit/query"

export function requestErrorStatus(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const fetchError = error as FetchBaseQueryError
    return fetchError.status === "PARSING_ERROR"
      ? fetchError.originalStatus
      : fetchError.status
  }
  return undefined
}

export function requestErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("data" in error))
    return undefined
  const { data } = error
  if (data && typeof data === "object" && "code" in data) return data.code
  return undefined
}

export function requestErrorMessage(error: unknown, fallback: string) {
  switch (requestErrorCode(error)) {
    case "no-collection":
      return "Choose a shelf for requested books first."
    case "invalid-collection":
      return "That shelf is no longer available. Choose another one."
    case "no-seeders-ebook":
      return "That ebook has no seeders now. Choose another version."
    case "no-seeders-audio":
      return "That audiobook has no seeders now. Choose another version."
    case "daily-limit":
      return "The daily download limit has been reached. Try again later."
    case "no-book":
      return "This book is no longer on your shelf."
    case "not-choosing":
      return "This format is already on its way."
    case "not-failed":
      return "This narration sync no longer needs a retry."
    case "adapter":
    case "no-infohash":
      return "The download source is unavailable right now. Try again later."
    default:
      return fallback
  }
}
