/**
 * The §22.6 assertions as pure functions over rows the verify step reads
 * (M7 L.F2.1). Both runtimes call these; vitest pins them.
 */

/** Nearest-rank percentile (p in (0, 100]); null for no samples. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  if (!(p > 0 && p <= 100)) throw new RangeError(`percentile: p must be in (0, 100], got ${p}`)
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.max(0, rank - 1)]!
}

export interface PickRow {
  pick_number: number
  player_id: string
  team_id: string
  is_undone: boolean | null
}

export interface DuplicateReport {
  /** Players drafted twice among standing (not undone) picks. */
  duplicatePlayers: string[]
  /** Pick numbers written twice among standing picks. */
  duplicatePickNumbers: number[]
}

/** §22.6 (1): "zero duplicate picks". */
export function duplicatePicks(rows: readonly PickRow[]): DuplicateReport {
  const seenPlayer = new Map<string, number>()
  const seenNumber = new Map<number, number>()
  for (const row of rows) {
    if (row.is_undone === true) continue
    seenPlayer.set(row.player_id, (seenPlayer.get(row.player_id) ?? 0) + 1)
    seenNumber.set(row.pick_number, (seenNumber.get(row.pick_number) ?? 0) + 1)
  }
  return {
    duplicatePlayers: [...seenPlayer].filter(([, n]) => n > 1).map(([id]) => id).sort(),
    duplicatePickNumbers: [...seenNumber].filter(([, n]) => n > 1).map(([k]) => k).sort((a, b) => a - b),
  }
}

export interface BidRow {
  nomination_seq: number
  team_id: string
  amount: number
  created_at: string
  voided_at: string | null
}

export interface StormVerdict {
  nominationSeq: number
  bids: number
  /** Standing bids in commit order must strictly rise — the draft-row lock
   *  serializes them (§22.1 "serialized by the draft-row lock"). */
  serialized: boolean
  maxAmount: number | null
  /** The award's price, when the nomination has been awarded. */
  awardedPrice: number | null
  /** An awarded nomination must sell at its highest standing bid. */
  awardMatchesHigh: boolean | null
}

/** §22.6 (2): one nomination's storm, judged from the stored rows. */
export function judgeStorm(nominationSeq: number, bids: readonly BidRow[], awardedPrice: number | null): StormVerdict {
  const standing = bids
    .filter((b) => b.nomination_seq === nominationSeq && b.voided_at === null)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  let serialized = true
  for (let i = 1; i < standing.length; i++) {
    if (!(standing[i]!.amount > standing[i - 1]!.amount)) serialized = false
  }
  const maxAmount = standing.length === 0 ? null : Math.max(...standing.map((b) => b.amount))
  return {
    nominationSeq,
    bids: standing.length,
    serialized,
    maxAmount,
    awardedPrice,
    awardMatchesHigh: awardedPrice === null ? null : awardedPrice === maxAmount,
  }
}

export interface AssertLine {
  name: string
  pass: boolean
  detail: string
  /** A measurement reported beside the asserts — never counted as one. */
  info?: boolean
}

export function renderAsserts(header: string, lines: readonly AssertLine[]): string[] {
  const out = [header]
  for (const line of lines) {
    out.push(`  ${line.info === true ? 'INFO' : line.pass ? 'PASS' : 'FAIL'}  ${line.name} — ${line.detail}`)
  }
  const asserts = lines.filter((l) => l.info !== true)
  out.push(`  ${allPass(lines) ? 'GREEN' : 'RED'}: ${asserts.filter((l) => l.pass).length}/${asserts.length} asserts`)
  return out
}

export function allPass(lines: readonly AssertLine[]): boolean {
  return lines.every((l) => l.info === true || l.pass)
}

/** "p95 = 123 ms over 456 samples" (or "no samples"). */
export function describeTrend(values: readonly number[]): string {
  const p95 = percentile(values, 95)
  if (p95 === null) return 'no samples'
  const p50 = percentile(values, 50)!
  return `p50 ${Math.round(p50)} ms · p95 ${Math.round(p95)} ms · max ${Math.round(Math.max(...values))} ms over ${values.length} samples`
}
