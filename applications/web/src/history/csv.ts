/** Split RFC 4180 fields, including embedded quotes and line breaks. */
export function* parseCsv(text: string): Generator<string[]> {
  let row: string[] = []
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (let i = start; i < text.length;) {
    if (text[i] === '"') {
      let end = text.indexOf('"', i + 1)
      while (end !== -1 && text[end + 1] === '"') {
        end = text.indexOf('"', end + 2)
      }
      if (end === -1) throw new Error("The CSV has an unclosed quoted field.")
      row.push(text.slice(i + 1, end).replaceAll('""', '"'))
      i = end + 1
      const separator = text[i]
      if (
        separator !== undefined &&
        separator !== "," &&
        separator !== "\r" &&
        separator !== "\n"
      ) {
        throw new Error("The CSV has unexpected text after a quoted field.")
      }
    } else {
      start = i
      while (
        i < text.length &&
        text[i] !== "," &&
        text[i] !== "\r" &&
        text[i] !== "\n"
      )
        i++
      const field = text.slice(start, i)
      // Some Goodreads exports emit their spreadsheet ISBN literals unquoted.
      if (field.includes('"') && !/^="[\dXx-]*"$/.test(field)) {
        throw new Error("The CSV has an unexpected quote in a field.")
      }
      row.push(field)
    }

    if (text[i] === ",") {
      i++
      if (i === text.length) row.push("")
    } else {
      if (text[i] === "\r" && text[i + 1] === "\n") i++
      i++
      yield row
      row = []
    }
  }
  if (row.length) yield row
}

/** Return the header and a single-pass iterator over the nonempty records. */
export function csvTable(text: string) {
  const rows = parseCsv(text)
  const first = rows.next()
  if (first.done) throw new Error("The CSV has no header.")
  const header = first.value
  return {
    header,
    *rows() {
      for (const row of rows) {
        if (row.every((value) => !value.trim())) continue
        if (row.length !== header.length) {
          throw new Error(
            "A CSV record has a different number of fields than the header.",
          )
        }
        yield row
      }
    },
  }
}
