import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * LV.13 — the Side by side columns, pinned at the source.
 *
 * **Source pins, not renders** — the same idiom and the same reason as
 * `side-by-side-picker.test.ts`, `ai-surfaces.test.ts` and
 * `ui/elevation-rule.test.ts`: these are `.tsx`, which Vite cannot parse under
 * Next's `jsx: "preserve"`. The behaviour that *can* be executed is executed —
 * `bucketHeading` and `rankMap` are pinned for real in `list-buckets.test.ts`,
 * which is where this task put the rules a column shares with the detail panel
 * precisely so they would be falsifiable.
 *
 * **Every assertion below reads the comment-stripped source** (`code`), never
 * the raw file. LV.12's review twice found a pin that was green for the wrong
 * reason, including one satisfied by a *comment* — and this file documents the
 * very decisions its negative assertions forbid, so matching raw text would
 * pass on the explanation.
 */

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/**
 * The full-bleed scroller's **own** class string, isolated from the file.
 *
 * `flex-col` is legitimate several times over in this component — the column
 * `<section>`, the loading skeleton, the error block — so a file-wide ban on it
 * would be a false positive. The one element that must never stack is the
 * scroller, and it is identifiable by the negative margin no other element
 * carries. A rename that loses that marker throws rather than passing silently:
 * a guard that cannot find what it guards is not green, it is broken.
 */
const scrollerClass = (source: string) => {
  const match = source.match(/className="([^"]*-mx-4[^"]*)"/)
  if (!match) {
    throw new Error(
      'LV.13: no className containing `-mx-4` — the full-bleed scroller could not be located, ' +
        'so the no-stacking pin below is guarding nothing.',
    )
  }
  return match[1]
}

const COLUMNS = 'src/components/lists/v2/side-by-side-columns.tsx'
const PAGE = 'src/components/lists/v2/lists-page-v2.tsx'
const SHELL = 'src/components/layout/app-shell.tsx'

describe('LV.13 — the scroller is full-bleed against the shell’s real gutter', () => {
  /**
   * The design LAW's `margin: 0 -36px; padding: 0 36px 8px` only works when the
   * 36 is the page's own horizontal padding. This app's is `px-4 lg:px-7`
   * (`app-shell.tsx`), and 28px *is* 36 × 0.8 — so the two numbers have to move
   * together. A negative margin larger than the padding pushes the whole page
   * into a horizontal scroll; a smaller one stops the strip short of the edge
   * and the bleed silently does nothing.
   */
  it('the negative margin matches the padding at both breakpoints', () => {
    const source = code(COLUMNS)
    expect(source).toContain('-mx-4')
    expect(source).toContain('px-4')
    expect(source).toContain('lg:-mx-7')
    expect(source).toContain('lg:px-7')
    // Its own scroll container, so the overflow never reaches the page body.
    expect(source).toContain('overflow-x-auto')
  })

  it('the shell still applies exactly that gutter to /app/lists', () => {
    const shell = code(SHELL)
    expect(shell).toContain("!fullBleed && 'px-4 lg:px-7'")
    // `/app/lists` (no trailing slash) is NOT in the full-bleed prefix list, so
    // the page really is padded and the bleed above really is needed.
    expect(shell).toContain("FULL_BLEED_PREFIXES: readonly string[] = ['/app/lists/']")
  })

  it('columns are the 300px panel at this app’s ×0.8 scale, and do not shrink', () => {
    expect(code(COLUMNS)).toContain('w-[240px] shrink-0')
  })

  /**
   * **No phone-specific treatment** — ruled by Chris 2026-08-11 (*"id say leave
   * the phone version as is"*). A width that collapses at a breakpoint is the
   * exact thing that ruling declines, and it would arrive as a well-meaning
   * "fix" for a 240px column on a 375px screen.
   */
  it('carries no breakpoint override of the column width', () => {
    expect(code(COLUMNS)).not.toMatch(/(sm|md|lg|xl):w-(full|\[)/)
  })

  /**
   * The other half of the same ruling — **no stacking**, in whichever spelling.
   *
   * This assertion was originally only `not.toMatch(/(sm|md|lg|xl):flex-col/)`,
   * which catches the *desktop-first* spelling and nothing else. The LV.13
   * Reviewer showed the gap by changing the scroller to
   * `-mx-4 flex flex-col lg:flex-row items-start` — the idiomatic **mobile-first**
   * way to stack on a phone, and precisely the "fix" D14 declines — and the file
   * stayed 21/21 green (**R218**). PROGRESS §3 Q4 and plan D14 both cited this
   * test as what makes the ruling un-re-addable, so the pin was documented as
   * protection it did not provide: worse than no pin, because the next Builder
   * reads the claim and not the regex.
   *
   * So: **no breakpoint flex-direction change at all**, in either direction —
   * `lg:flex-col` and `lg:flex-row` are equally forbidden, since a `lg:flex-row`
   * only exists to undo a `flex-col` below it — plus a bare `flex-col` on the
   * scroller itself, which would stack at every width with no breakpoint to
   * spot.
   */
  it('the scroller cannot stack, in either spelling of it', () => {
    const source = code(COLUMNS)
    expect(source).not.toMatch(/(sm|md|lg|xl):flex-(col|row)/)
    expect(scrollerClass(source)).not.toMatch(/\bflex-col\b/)
  })
})

describe('LV.13 — it composes Round 1 rather than re-solving it (D11)', () => {
  it('takes grouping, covers, rows and marks from the modules that own them', () => {
    const source = code(COLUMNS)
    expect(source).toContain("import { ListCoverTile } from './cover-tile'")
    expect(source).toContain(
      "import { bucketHeading, buildBuckets, ORG_OPTIONS, rankMap } from './list-buckets'",
    )
    expect(source).toContain(
      "import { DraftedCheckbox, EmptyListState, PlayerMeta, PlayerName } from './list-row-parts'",
    )
    expect(source).toContain("import { useDraftMode } from '@/hooks/use-draft-mode'")
    // The fan-out is composed too — LV.14 put it in its own module rather than
    // inline, so its decisions are executable (D11: compose, do not re-solve).
    expect(source).toMatch(/useDraftedFanOut,\s*useRegisterFanOutColumn,/)
    expect(source).toContain("import { usePlayerWindowsStore } from '@/stores/player-windows-store'")
  })

  it('renders those parts rather than local lookalikes', () => {
    const source = code(COLUMNS)
    expect(source).toContain('<DraftedCheckbox drafted={drafted} onToggle={onToggleDrafted} />')
    expect(source).toContain('<PlayerMeta entry={entry} />')
    expect(source).toContain('<ListCoverTile list={cover} players={summary?.first_players} size={21} />')
    // The name is the shared part *with* its mini-card affordance wired up —
    // the design LAW asks for it by name ("links to the mini card").
    expect(source).toMatch(/<PlayerName\b[\s\S]*?onOpen=\{onOpenPlayer\}/)
    expect(source).toContain('openPlayerWindow(entry.player_id, {')
  })

  it('defines no second bucketing, ramp or checkbox of its own', () => {
    const source = code(COLUMNS)
    expect(source).not.toMatch(/function\s+\w*[Bb]uckets?\w*\s*\(/)
    expect(source).not.toContain('bg-tier-')
    expect(source).not.toContain('BAND_RAMP')
    expect(source).not.toContain('aria-pressed')
    // The band's fill is whatever `list-buckets.ts` already decided.
    expect(source).toContain('bucket.className')
  })
})

describe('LV.13 — each column groups independently', () => {
  it('the grouping menu is keyed to this column’s own list id', () => {
    const source = code(COLUMNS)
    expect(source).toMatch(/onSelect=\{\(\) => setOrg\(listId, option\.id\)\}/)
    // From the shared option list, so all five modes are offered and a sixth
    // added later shows up here for free.
    expect(source).toMatch(/ORG_OPTIONS\.map\(\(option\) =>/)
  })

  it('`Remove column` sits under a separator, as the LAW words it', () => {
    const source = code(COLUMNS)
    expect(source).toMatch(/<DropdownMenuSeparator \/>\s*<DropdownMenuItem onSelect=\{onRemove\}>/)
    expect(source).toContain('Remove column')
  })

  it('the column reads its grouping from the session store, not from a local copy', () => {
    const source = code(COLUMNS)
    expect(source).toContain('const display = useListDisplay(listId)')
    expect(source).toMatch(/resolveOrg\(display\.org,/)
  })

  /**
   * **D3.** The detail panel's grouping control additionally persists
   * `lists.ranking_mode`, and that is a restoration of the last `rank_and_tier`
   * writer in the codebase (PROGRESS §3 Q3) — not a rule about grouping. A
   * comparison routinely holds lists you do not own, where that write is not
   * yours to make, so this menu makes none.
   */
  it('changing a column’s grouping writes nothing to the server', () => {
    const source = code(COLUMNS)
    expect(source).not.toContain('useUpdateList')
    expect(source).not.toContain('ranking_mode:')
    expect(source).not.toContain('useMutation')
  })
})

/**
 * **This block was LV.13's `a tick is one tick on one list`, and LV.14 is the
 * release that inverts it.** Its pins are not deleted — they are re-aimed at the
 * behaviour that replaced them, because the property they were really guarding
 * (*a tick reaches exactly the lists it should, and no others*) is the same
 * property D12 governs; only the boundary moved, from one list to the
 * comparison set. The fan-out's own decisions are **executed**, not pinned, in
 * `drafted-fan-out.test.ts`; what is left here is the JSX wiring that connects
 * them, which vitest cannot render.
 */
describe('LV.14 — a tick fans out across the comparison set, and no further (D12)', () => {
  it('the tick goes to the fan-out, not to this column alone', () => {
    const source = code(COLUMNS)
    expect(source).toContain('const { drafted, desiredDraftedFor, setDrafted } = useDraftMode(listId)')
    expect(source).toMatch(
      /onToggleDrafted=\{\(\) =>\s*fanOut\.tick\(listId, entry\.player_id, entry\.player\.full_name\)\s*\}/,
    )
    // The pre-LV.14 body, verbatim: the mark that stopped at its own column.
    expect(source).not.toContain('toggleDrafted(entry.player_id)')
  })

  it('every column joins the fan-out with its own name, rows, state and write', () => {
    const source = code(COLUMNS)
    expect(source).toContain('useRegisterFanOutColumn(fanOut, listId, {')
    expect(source).toContain('desiredFor: desiredDraftedFor')
    expect(source).toContain('write: (playerId, next) => setDrafted(playerId, next, { notify: false })')
  })

  /**
   * The four membership answers, and the one that matters most: a column whose
   * rows have not arrived is `loading`, **never** `out`. Reading "no rows yet"
   * as "he is not on this list" would drop him from the fan-out silently — the
   * "nothing happened means it worked" shape, applied to a set membership.
   */
  it('an unloaded column says so instead of answering "he is not on it"', () => {
    const source = code(COLUMNS)
    // The whole decision, in order, so an arm cannot be dropped or reordered —
    // `!memberIds → 'loading'` has to sit ABOVE the `.has()` test, or an
    // unloaded column answers `out` and drops out of the fan-out in silence.
    expect(source.replace(/\s+/g, ' ')).toContain(
      "membership: (playerId): ColumnMembership => detail.isError ? 'unreadable' " +
        ": !memberIds ? 'loading' : memberIds.has(playerId) ? 'in' : 'out',",
    )
    // `null` while unknown, not an empty Set — the distinction the above rests on.
    expect(source).toContain('entries ? new Set(entries.map((entry) => entry.player_id)) : null')
  })

  /**
   * The comparison order is the only source of the fan-out set (D12): `ids` is
   * mapped into columns and handed to the fan-out, and is not iterated a third
   * time next to a write. A list outside the comparison is not reachable from
   * this file at all.
   */
  it('the fan-out set comes from the comparison and nowhere else', () => {
    const source = code(COLUMNS)
    expect(source.match(/\bids\b/g) ?? []).toHaveLength(4)
    expect(source).toContain('{ids.map((id) => (')
    expect(source).toContain('const fanOut = useDraftedFanOut(ids)')
    expect(source).not.toMatch(/ids\.(forEach|filter|reduce)/)
    // No second source for "which lists hold this player".
    expect(source).not.toContain('useLists(')
  })

  it('the header count is derived per column from that column’s own rows', () => {
    expect(code(COLUMNS)).toContain(
      'const left = (entries ?? []).filter((entry) => !drafted.has(entry.player_id)).length',
    )
  })

  /**
   * A column that says `0 of 0 left` while its request is still in flight is
   * CLAUDE.md's "never let 'nothing happened' mean 'it worked'" as a headline
   * number, on the screen where that number is the entire point.
   */
  it('the count is not claimed over an unloaded or failed read', () => {
    const source = code(COLUMNS)
    expect(source).toMatch(/detail\.isError\s*\?\s*'Could not load'/)
    expect(source).toMatch(/:\s*entries\s*\?\s*`\$\{left\} of \$\{entries\.length\} left`/)
    expect(source).toMatch(/:\s*'Loading…'/)
  })
})

describe('LV.13 — elevation, and the page seam LV.12 left', () => {
  /** `shadow-hard-*` NOT preceded by an interaction-state prefix. */
  const RESTING_SHADOW = /(?<![\w-])(?<!:)shadow-hard-[\w-]+/g

  it('the panels rest flat and lift only on hover', () => {
    const source = code(COLUMNS)
    expect([...source.matchAll(RESTING_SHADOW)].map((m) => m[0])).toEqual([])
    expect(source).toContain('border border-ink bg-white transition-shadow hover:shadow-hard-4')
  })

  it('a drafted row is fill plus strike-through, never a shadow', () => {
    const source = code(COLUMNS)
    expect(source).toContain("drafted ? 'bg-n-4' : 'bg-white hover:bg-accent-soft'")
    // The strike-through itself is `PlayerName`'s, driven by the same flag.
    expect(source).toMatch(/<PlayerName[\s\S]*?drafted=\{drafted\}/)
  })

  it('ComparisonPending is deleted, not orphaned', () => {
    const source = code(PAGE)
    expect(source).not.toContain('ComparisonPending')
    expect(source).not.toContain('Pick different lists')
    expect(source).not.toContain('isList')
    expect(source).toContain('<SideBySideColumns')
  })

  it('`Change lists` is in the page header, this mode only, past the picker', () => {
    const source = code(PAGE)
    expect(source).toMatch(
      /const changeListsButton =\s*mode === 'compare' && compareIds\.length > 0 \?/,
    )
    expect(source).toContain('Change lists')
    expect(source).toContain('onClick={() => setCompareIds([])}')
    // Rendered twice — the shell hides its header below `lg`, so a phone would
    // otherwise have no way back to the picker (the same reason `modeSwitch`
    // and `tabSwitch` render twice).
    expect(source.match(/\{changeListsButton\}/g) ?? []).toHaveLength(2)
  })

  it('removing a column narrows the comparison instead of clearing it', () => {
    expect(code(PAGE)).toContain(
      'onRemove={(id) => setCompareIds((ids) => ids.filter((value) => value !== id))}',
    )
  })

  it('the comparison stays session-only (D3)', () => {
    for (const file of [COLUMNS, PAGE]) {
      const source = code(file)
      expect(source, file).not.toContain('localStorage')
      expect(source, file).not.toContain('persist(')
    }
  })
})
