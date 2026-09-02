/**
 * A small RFC-4180 CSV reader for the nflverse published files (L.D3.1).
 *
 * Deliberately dependency-free and strict: quoted fields (commas, doubled
 * quotes, embedded newlines) are honoured, CRLF is tolerated, and a ragged
 * row — one whose field count differs from the header's — REFUSES with the
 * line number rather than being silently padded or truncated (CLAUDE.md:
 * never let "nothing happened" mean "it worked"; tasks-M4 §4 rule 10's
 * loud-emptiness clause extends to loud malformation).
 *
 * Lines beginning with `#` BEFORE the header are provenance comments (the
 * committed `__fixtures__` files carry their source URL + fetch date that
 * way) and are skipped; nflverse's own files never start with one.
 */

export interface CsvTable {
  header: string[]
  rows: string[][]
}

export function parseCsv(input: string): CsvTable {
  // Provenance comments precede the header (whole lines, so a comma inside
  // one never splits it); nflverse's own files never start with `#`.
  let text = input
  while (text.startsWith('#')) {
    const nl = text.indexOf('\n')
    text = nl === -1 ? '' : text.slice(nl + 1)
  }
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  let line = 1
  let i = 0
  const n = text.length

  const endField = () => {
    record.push(field)
    field = ''
  }
  const endRecord = () => {
    endField()
    records.push(record)
    record = []
  }

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      if (ch === '\n') line += 1
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      endField()
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      endRecord()
      line += 1
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (inQuotes) throw new Error(`csv: unterminated quoted field at end of input (line ${line})`)
  if (field.length > 0 || record.length > 0) endRecord()

  // A trailing empty record (from a final newline) is not a row.
  if (records.length === 0) throw new Error('csv: no header row')
  const header = records[0]
  const rows: string[][] = []
  for (let r = 1; r < records.length; r += 1) {
    const rec = records[r]
    if (rec.length === 1 && rec[0] === '') continue
    if (rec.length !== header.length) {
      throw new Error(
        `csv: row ${r + 1} has ${rec.length} fields, header has ${header.length} — refusing a ragged file`,
      )
    }
    rows.push(rec)
  }
  return { header, rows }
}

/**
 * Every column the caller reads must be present by NAME — an nflverse
 * schema change (a renamed or dropped column) fails here, loudly, before a
 * single row is interpreted. Extra columns are fine (the files carry ~45).
 */
export function requireColumns(table: CsvTable, required: readonly string[], what: string): void {
  const present = new Set(table.header)
  const missing = required.filter((c) => !present.has(c))
  if (missing.length > 0) {
    throw new Error(
      `${what}: unexpected header set — missing column(s) ${missing.join(', ')} (have: ${table.header.join(', ')})`,
    )
  }
}

/** Rows as name → value objects over the header (after requireColumns). */
export function toObjects(table: CsvTable): Array<Record<string, string>> {
  return table.rows.map((row) => {
    const out: Record<string, string> = {}
    table.header.forEach((name, k) => {
      out[name] = row[k]
    })
    return out
  })
}
