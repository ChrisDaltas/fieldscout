/**
 * Primary brand color for each NFL team, keyed by Sleeper-style 3-letter
 * abbreviation. Sourced from docs/nfl-team-colors.md.
 *
 * The color we expose is the team's "main identity" color (the one most
 * fans recognize the team by) — used in the player card to tint the
 * headshot circle with a subtle team-flavored background.
 */
export interface NflTeamColors {
  primary: string
  secondary: string
}

export const NFL_TEAM_COLORS: Record<string, NflTeamColors> = {
  // AFC East
  NE: { primary: '#002244', secondary: '#C60C30' },
  BUF: { primary: '#00338D', secondary: '#C60C30' },
  MIA: { primary: '#008E97', secondary: '#FC4C02' },
  NYJ: { primary: '#125740', secondary: '#FFFFFF' },

  // AFC North
  BAL: { primary: '#241773', secondary: '#9E7C0C' },
  CIN: { primary: '#FB4F14', secondary: '#000000' },
  CLE: { primary: '#FF3C00', secondary: '#311D00' },
  PIT: { primary: '#FFB612', secondary: '#101820' },

  // AFC South
  HOU: { primary: '#03202F', secondary: '#A71930' },
  IND: { primary: '#002C5F', secondary: '#A2AAAD' },
  JAX: { primary: '#006778', secondary: '#9F792C' },
  TEN: { primary: '#4B92DB', secondary: '#0C2340' },

  // AFC West
  DEN: { primary: '#FB4F14', secondary: '#002244' },
  KC: { primary: '#E31837', secondary: '#FFB81C' },
  LV: { primary: '#000000', secondary: '#A5ACAF' },
  LAC: { primary: '#0080C6', secondary: '#FFC20E' },

  // NFC East
  DAL: { primary: '#003594', secondary: '#869397' },
  NYG: { primary: '#0B2265', secondary: '#A71930' },
  PHI: { primary: '#004C54', secondary: '#A5ACAF' },
  WAS: { primary: '#5A1414', secondary: '#FFB612' },

  // NFC North
  CHI: { primary: '#0B162A', secondary: '#C83803' },
  DET: { primary: '#0076B6', secondary: '#B0B7BC' },
  GB: { primary: '#203731', secondary: '#FFB612' },
  MIN: { primary: '#4F2683', secondary: '#FFC62F' },

  // NFC South
  ATL: { primary: '#A71930', secondary: '#000000' },
  CAR: { primary: '#0085CA', secondary: '#101820' },
  NO: { primary: '#D3BC8D', secondary: '#101820' },
  TB: { primary: '#D50A0A', secondary: '#FF7900' },

  // NFC West
  ARI: { primary: '#97233F', secondary: '#000000' },
  LAR: { primary: '#003594', secondary: '#FFA300' },
  SF: { primary: '#AA0000', secondary: '#B3995D' },
  SEA: { primary: '#69BE28', secondary: '#002244' },
}

const FALLBACK: NflTeamColors = {
  primary: '#3B82F6', // neutral blue
  secondary: '#A5ACAF',
}

export function getTeamColors(team: string | null | undefined): NflTeamColors {
  if (!team) return FALLBACK
  return NFL_TEAM_COLORS[team.toUpperCase()] ?? FALLBACK
}

/**
 * Returns the team primary color combined with an alpha suffix so it can be
 * used directly as a `backgroundColor` style. Alpha is a 0–1 number that we
 * convert to a 2-char hex.
 */
export function teamTintBackground(team: string | null | undefined, alpha: number): string {
  const { primary } = getTeamColors(team)
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${primary}${a}`
}

/**
 * Darker variant of the team primary, used for the visible stroke around the
 * tinted-background headshot. Multiplies each RGB channel by `factor` (0..1)
 * so the team's identity color is retained but at a darker, calmer weight
 * that frames the lighter tint background cleanly.
 */
export function darkTeamPrimary(
  team: string | null | undefined,
  factor = 0.55,
): string {
  const { primary } = getTeamColors(team)
  if (!/^#[0-9a-fA-F]{6}$/.test(primary)) return primary
  const n = parseInt(primary.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const f = Math.max(0, Math.min(1, factor))
  const dr = Math.round(r * f)
  const dg = Math.round(g * f)
  const db = Math.round(b * f)
  return (
    '#' +
    [dr, dg, db].map((v) => v.toString(16).padStart(2, '0')).join('')
  )
}
