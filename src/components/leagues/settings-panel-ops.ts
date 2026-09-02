/**
 * Pure ops for the League settings panel (the `*-ops.ts` pattern — no React,
 * no DOM; pinned by `settings-panel-ops.test.ts`).
 *
 * `DIVISION_OPTIONS` — spec §7.3.1 `divisions` row, v2.16.12 (Q30 RULED (d),
 * Chris 2026-09-02): divisions are CUT from v1. The setting stays in the
 * catalog (Zod keeps its 1–2 parse range so stored rows stay valid — PROGRESS
 * F221's return path is additive), the schedule engine IGNORES the value
 * (migration 110, pinned in pgTAP 058), and the select renders EXACTLY ONE
 * option. This constant is the one home of that pin (tasks-M4 L.D1.2 item 1,
 * R719/R723): when divisions return, the option list grows here and the
 * engine's ignore-pin flips in the same change.
 */
export const DIVISION_OPTIONS = [1] as const

/** `{value,label}` list for the Divisions select — the same shape `numOptions` builds. */
export function divisionSelectOptions(): ReadonlyArray<{ value: string; label: string }> {
  return DIVISION_OPTIONS.map((v) => ({ value: String(v), label: String(v) }))
}
