/**
 * Draft lobby — pure derivation (M2 task L.B3.4; spec §8.5.1, §16.5.2
 * draft-night row "lobby (presence, checklist)", D94/D101). Colocated with
 * `draft-lobby.tsx` per the ops-split precedent (L.A2.x / pick-clock-ops) so
 * every readiness/order rule is pinnable without React. Time-dependent reads
 * take `nowMs` (the D82(4) precedent — the component owns the ticking clock;
 * no wall-clock read in here).
 *
 * Server-authoritative discipline (D90 spirit): nothing here VALIDATES a
 * start — `draft_start` owns capacity/order/snapshot refusals and its
 * friendly strings surface verbatim. The checklist is honest readiness
 * DISPLAY derived from the same rows the server reads, never a TS twin the
 * Start button trusts.
 */

import type { LeagueDetail } from '@/hooks/use-league'

import { parseDraftOrder } from './draft-board-ops'

// ---------------------------------------------------------------------------
// Checklist (§16.5.2 "lobby (presence, checklist)": seats / settings / order)
// ---------------------------------------------------------------------------

export type LobbyChecklistKey = 'seats' | 'settings' | 'order'

export interface LobbyChecklistItem {
  key: LobbyChecklistKey
  label: string
  done: boolean
  detail: string
}

/** The pick-clock flavor line for the settings row. */
function clockLabel(pickTimerSeconds: number): string {
  if (pickTimerSeconds === 0) return 'no pick clock (untimed)'
  if (pickTimerSeconds < 60) return `${pickTimerSeconds}-second pick clock`
  if (pickTimerSeconds === 90) return '90-second pick clock'
  if (pickTimerSeconds < 3600) return `${Math.round(pickTimerSeconds / 60)}-minute pick clock`
  return `${Math.round(pickTimerSeconds / 3600)}-hour pick clock`
}

/**
 * The lobby's three readiness rows. `storedOrderIds` is the resolved order
 * display list (see `lobbyOrderTeamIds`) so the order row and the order
 * display can never disagree about whether an order exists.
 *
 * - seats: claimed managers n/N — informational (empty seats are franchises
 *   and autodraft, D96/E48; an unclaimed seat never blocks a start).
 * - settings: the scoring template (draft_start snapshots it — D43; missing
 *   template IS a start blocker, surfaced here before the server refusal).
 * - order: random mode is always ready (066 shuffles at start when nothing
 *   is stored — D101); manual/custom with no stored order is the one order
 *   state `draft_start` will refuse.
 */
export function deriveLobbyChecklist(
  detail: LeagueDetail,
  storedOrderIds: readonly string[],
): LobbyChecklistItem[] {
  const total = detail.league.max_teams
  const claimed = detail.members.filter((m) => m.user_id != null).length
  const hasScoring = detail.league.scoring_system_id != null
  const mode = detail.settings.draft.draft_order_mode
  const hasOrder = storedOrderIds.length > 0

  const orderDetail = hasOrder
    ? mode === 'random'
      ? 'Randomized — the order is locked in'
      : 'Order is set'
    : mode === 'random'
      ? 'Randomizes automatically at start'
      : 'No saved order yet — set one in League settings'

  return [
    {
      key: 'seats',
      label: 'Manager seats',
      done: claimed === total,
      detail:
        claimed === total
          ? `All ${total} seats claimed`
          : `${claimed} / ${total} seats claimed — empty seats autodraft`,
    },
    {
      key: 'settings',
      label: 'Settings ready',
      done: hasScoring,
      detail: hasScoring
        ? `Scoring template chosen · ${clockLabel(detail.settings.draft.pick_timer_seconds)}`
        : 'Pick a scoring template before the draft can start',
    },
    {
      key: 'order',
      label: 'Draft order',
      done: hasOrder || mode === 'random',
      detail: orderDetail,
    },
  ]
}

// ---------------------------------------------------------------------------
// Order display (task item 1: "post-randomize list — no animation, D101/F43")
// ---------------------------------------------------------------------------

/**
 * The team-id list the lobby displays, in pick-1 order. Preference is the
 * DRAFTS row's stored `draft_order` (a pre-start randomize writes it there —
 * D101's result-before-start; an existing row's order is what `draft_start`
 * honors) over the settings blob's saved array (the manual/custom store —
 * D95 hydrates it at start when no row order exists). Empty when neither
 * exists (random mode pre-randomize: the order genuinely doesn't exist yet,
 * and the lobby says so rather than inventing one).
 */
export function lobbyOrderTeamIds(
  draftRowOrder: unknown,
  settingsOrder: readonly string[] | null,
): string[] {
  const fromRow = parseDraftOrder(draftRowOrder)
  if (fromRow.length > 0) return fromRow
  return settingsOrder ? [...settingsOrder] : []
}

// ---------------------------------------------------------------------------
// Presence extras (§16.5.4 autopick-on badge in the lobby's seat strip)
// ---------------------------------------------------------------------------

/**
 * Seats that render the Auto badge in the lobby: the §8.4 `is_autodraft`
 * flag, or a seat with no user (placeholder/vacated — E48's autopilot picks
 * for it). Mirrors the room's derivation (L.B3.3) for non-mock drafts —
 * mocks never sit in the lobby (they launch straight to `live`, §8.8).
 */
export function lobbyAutopickTeamIds(members: LeagueDetail['members']): Set<string> {
  const ids = new Set<string>()
  for (const member of members) {
    if (member.team_id && (member.is_autodraft === true || !member.user_id)) {
      ids.add(member.team_id)
    }
  }
  return ids
}
