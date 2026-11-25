declare global {
  // eslint-disable-next-line no-var
  var recommendationReferenceDate: string | null | undefined
}

/**
 * Pretend today is `date` (`YYYY-MM-DD`): history after it and books
 * released after it do not exist. Only the backtest sets this.
 */
export function setReferenceDate(date: string | null): void {
  globalThis.recommendationReferenceDate = date
}

export function referenceDate(): string | null {
  return globalThis.recommendationReferenceDate ?? null
}

/**
 * A time as SQLite's CURRENT_TIMESTAMP writes it (UTC, no zone). Stored
 * times use this form: ISO strings with a zone come back as Date objects.
 */
export function sqlTime(ms: number = Date.now()): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19)
}
