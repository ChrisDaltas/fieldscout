import { describe, expect, it } from 'vitest'

import { buildIndex, matchPlayers, nameKey, normalize } from './match'

const P = (id: string, full_name: string, team: string | null) => ({ id, full_name, team })

// Two real same-name pairs (QB Josh Allen BUF / a JAX namesake; two Mike Williams).
const pool = [
  P('allen-buf', 'Josh Allen', 'BUF'),
  P('allen-jax', 'Josh Allen', 'JAX'),
  P('mw-pit', 'Mike Williams', 'PIT'),
  P('mw-nyj', 'Mike Williams', 'NYJ'),
  P('mccarthy', 'J.J. McCarthy', 'NYG'),
  P('cooper', 'Omar Cooper Jr.', 'NYJ'),
  P('love', 'Jordan Love', 'GB'),
  P('carter', 'Michael Carter', 'TEN'),
  P('mono', 'Prince', 'KC'),
]
const ids = (text: string, players = pool) => matchPlayers(text, buildIndex(players)).map((m) => m.player_id).sort()

describe('normalize / nameKey', () => {
  it('folds punctuation, accents and suffixes', () => {
    expect(normalize("J.J. McCarthy's")).toBe('jj mccarthy')
    expect(nameKey('Omar Cooper Jr.')).toBe('omar cooper')
    expect(nameKey('Zoë Señor III')).toBe('zoe senor')
  })
})

describe('matchPlayers — name + team', () => {
  it('a shared name matches only the player whose team is named', () => {
    expect(ids('Josh Allen, Buffalo Bills, now 5-1, finding ways to win close games')).toEqual(['allen-buf'])
    expect(ids('Jaguars pass rusher Josh Allen records two sacks')).toEqual(['allen-jax'])
    expect(ids('Josh Allen (JAX) limited in practice')).toEqual(['allen-jax'])
  })

  it('a shared name with NO team named matches nobody (Josh Allen alone)', () => {
    expect(ids('Josh Allen throws three touchdowns')).toEqual([])
  })

  it('a shared name with BOTH teams named is ambiguous → nobody', () => {
    expect(ids('Bills vs. Jaguars: Josh Allen leads the way')).toEqual([])
  })

  it('R1593: a shared city needs its nickname — "Los Angeles Rams" is not the Chargers', () => {
    const la = [P('kupp-lac', 'Quentin Johnston', 'LAC'), P('kupp-lar', 'Quentin Johnston', 'LAR')]
    expect(ids('Quentin Johnston catches TD for the Los Angeles Rams', la)).toEqual(['kupp-lar'])
    expect(ids('Quentin Johnston catches TD in Los Angeles', la)).toEqual([])
    expect(ids('Mike Williams catches TD in New York')).toEqual([])
  })

  it('city alone counts as the team; abbreviation is case-sensitive', () => {
    expect(ids('Mike Williams, Pittsburgh receiver, catches two')).toEqual(['mw-pit'])
    expect(ids('Mike Williams of NYJ is questionable')).toEqual(['mw-nyj'])
    expect(ids('Mike Williams of nyj is questionable')).toEqual([])
  })
})

describe('matchPlayers — unique name', () => {
  it('a unique full name matches without a team', () => {
    expect(ids('Jordan Love touchdown pass gives Packers 7-0 lead')).toEqual(['love'])
    expect(ids('Caleb Williams shows no rust; Jordan Love sharp')).toEqual(['love'])
  })

  it('punctuation and suffix variants still match', () => {
    expect(ids('Giants QB JJ McCarthy threw for 243 yards')).toEqual(['mccarthy'])
    expect(ids('Welcome back Omar Cooper Jr.')).toEqual(['cooper'])
  })

  it('last name alone never matches (precision over recall)', () => {
    expect(ids('Love finds Golden for TD as Packers strike first')).toEqual([])
    expect(ids('McCarthy benched')).toEqual([])
  })

  it('a unique name preceded by ANOTHER team is a namesake → no match', () => {
    expect(ids('Jets RB Michael Carter signs practice squad deal')).toEqual([])
    expect(ids('Titans RB Michael Carter scores')).toEqual(['carter'])
  })

  it('a name embedded in a longer word sequence still needs whole words', () => {
    expect(ids('Jordan Lovely wins the award')).toEqual([])
  })

  it('R1591: another team right before the name blocks BOTH rules', () => {
    const buf = [P('allen-buf', 'Josh Allen', 'BUF')]
    // name_team would fire (Bills named) — the guard must run first.
    expect(ids('Jaguars LB Josh Allen strip-sacks Bills QB in the fourth', buf)).toEqual([])
    expect(ids("Jacksonville's Josh Allen records two sacks", buf)).toEqual([])
    expect(ids('Jacksonville LB Josh Allen records two sacks', buf)).toEqual([])
    expect(ids('JAX edge Josh Allen dominates', buf)).toEqual([])
    // His own team before his name is fine.
    expect(ids('Bills QB Josh Allen throws three TDs', buf)).toEqual(['allen-buf'])
    // An English-word abbreviation ("was") is not a team.
    expect(ids('Who was Josh Allen throwing to?', buf)).toEqual(['allen-buf'])
  })

  it('R1591: a shared city before the name only blocks with its nickname', () => {
    const lac = [P('herbert', 'Justin Herbert', 'LAC')]
    expect(ids('Los Angeles QB Justin Herbert sharp in win', lac)).toEqual(['herbert'])
    expect(ids('Los Angeles Rams star Justin Herbert?', lac)).toEqual([])
  })

  it('a single-word name is never matched', () => {
    expect(ids('Prince scores for the Chiefs')).toEqual([])
  })
})
