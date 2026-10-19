'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

import { membersPageHref } from '@/components/leagues/invite-panel-ops'
import { isCustomScoringReference } from '@/components/leagues/scoring-editor-ops'
import { COMMISH_ROW_NOTE, COMMISH_ROW_TITLE, formatDraftInstant, useInSeasonSettingsSave } from '@/components/leagues/settings-panel'
import type { SettingsSection } from '@/components/leagues/settings-index-ops'
import {
  SETTINGS_OVERRIDE_BAR_OFF_COPY,
  SETTINGS_POLICY_LOADING_COPY,
  SETTINGS_POLICY_PROBLEM_COPY,
  settingPolicyKeys,
  type SettingSaveResult,
} from '@/components/leagues/settings-panel-ops'
import { CenteredNote, LeaguePageBar } from '@/components/mobile/league/league/league-bits'
import { SettingsSkeleton } from '@/components/mobile/settings/settings-parts'
import { leagueAvClass } from '@/components/mobile/shell/use-league-card'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen, MPageBarAction } from '@/components/mobile/ui/mobile-header'
import { UsernameLink } from '@/components/shared/username-link'
import { useCommishSettingPolicies } from '@/hooks/use-commish-setting-policy'
import { useLeagueScoringFamily } from '@/hooks/use-draft-pool'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useLeagues } from '@/hooks/use-leagues'
import { useScoringTemplates } from '@/hooks/use-scoring-templates'
import { commishConsoleHref } from '@/lib/leagues/api/commish-console-gate'
import { scoringRulesDocSchema } from '@/lib/leagues/scoring/validate-rules-doc'
import { cn } from '@/lib/utils'
import { useCommishOverrideStore, useOverrideMode } from '@/stores/commish-override-store'

import { LeagueProfileSheet } from './league-profile-sheet'
import { scrollToTop, SettingsEditScreen } from './league-settings-edit'
import {
  generalGroupFor,
  generalGroups,
  PAGE_TITLES,
  playoffsPage,
  scoringGroups,
  settingsPageFor,
  type SettingsGroup,
  type SettingsPage,
  type SettingsRow,
} from './league-settings-ops'

/** The handoff's footer under all three pages, for a member. */
export const MEMBER_FOOTER = 'Only the commissioner can change these settings'

/**
 * League Menu › League settings, Scoring and Playoffs on the phone (handoff
 * m-community G2; gap list §4 item 105) — the phone's screens for
 * `/settings`, on the same reads, routes and rules as desktop's settings
 * page (`SettingsPanel`), which is unchanged.
 *
 * `?section=` picks the page, as the Menu's rows already link: none is
 * League settings, `scoring` is Scoring, `league` is Playoffs; desktop's
 * other sections (the setup checklist's, the commissioner console's) open
 * League settings at that group.
 *
 * Every page is the handoff's G2 rows — 13/600 t3 section titles over
 * label / value rows on b2 hairlines — from the league's real settings and
 * scoring, with "Only the commissioner can change these settings" under
 * them for a member. Nothing desktop shows is dropped (`league-settings-ops`).
 *
 * A commissioner (or co-commissioner) changes them through the same paths:
 *  - before the draft, the bar's blue "Edit" opens the page's settings as
 *    the shared form groups in the phone skin (`SettingsEditScreen`) —
 *    Cancel / Save in the bar, one atomic PATCH (`useSettingsForm`);
 *  - once past it, settings lock (spec §7.1): the page offers THE override
 *    switch (the one the team and match screens obey), and with it on, Edit
 *    saves one recorded change per setting through `commish_change_setting`,
 *    closing what can't change mid-season with the server's own words. No
 *    reason is asked (reason is optional — never required);
 *  - the league's name and photo change in any status: the "League name"
 *    row opens `LeagueProfileSheet`.
 * Back goes to where you came from, else the League tab.
 */
export function MobileLeagueSettings({
  leagueId,
  section,
  startEditing = false,
}: {
  leagueId: string
  section: SettingsSection | null
  /** Open in the editor when the commissioner can edit now (`&edit=1` —
   *  the setup checklist's "Schedule the draft" / "Pick a scoring
   *  template"). */
  startEditing?: boolean
}) {
  const detail = useLeague(leagueId)
  const page = settingsPageFor(section)

  if (detail.isPending) {
    return (
      <MobileScreen header={<LeaguePageBar leagueId={leagueId} title={PAGE_TITLES[page]} />}>
        <SettingsSkeleton blocks={['row', 'row', 'row', 'row', 'row', 'row']} />
      </MobileScreen>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <MobileScreen header={<LeaguePageBar leagueId={leagueId} title={PAGE_TITLES[page]} />}>
        <CenteredNote role="alert" message="Couldn’t load this league’s settings." action="Try again" onAction={() => void detail.refetch()} />
      </MobileScreen>
    )
  }
  return <SettingsScreen leagueId={leagueId} detail={detail.data} page={page} section={section} startEditing={startEditing} />
}

function SettingsScreen({
  leagueId,
  detail,
  page,
  section,
  startEditing,
}: {
  leagueId: string
  detail: LeagueDetail
  page: SettingsPage
  section: SettingsSection | null
  startEditing: boolean
}) {
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  const status = detail.league.status
  // §7.1: everything edits in setup/scheduled; past that, override mode.
  const pastScheduled = status !== 'setup' && status !== 'scheduled'
  const storeMode = useOverrideMode(leagueId)
  const enterOverride = useCommishOverrideStore((s) => s.enter)
  const inSeasonOverride = isCommish && pastScheduled && storeMode
  const policyKeys = useMemo(() => settingPolicyKeys(detail.settings), [detail.settings])
  const policies = useCommishSettingPolicies(policyKeys, inSeasonOverride)
  const { saving, results, setResults, saveInSeason } = useInSeasonSettingsSave(leagueId)
  const canEdit = isCommish && (!pastScheduled || (inSeasonOverride && policies.data !== undefined && !saving))
  /** Edit shows wherever a commissioner could edit now — greyed while the
   *  mid-season table is still being read (prevent, don't refuse). */
  const showEdit = isCommish && (!pastScheduled || inSeasonOverride)
  const [editing, setEditing] = useState(() => startEditing && canEdit)
  // The editor scrolls to where it opens once per edit session — set as
  // Edit opens it, taken by its first mount. The editor remounts whenever
  // the persisted settings change under it (a save, a scoring fork); those
  // remounts find this false and leave the scroll alone.
  const openScroll = useRef(startEditing)
  const takeOpenScroll = () => {
    const take = openScroll.current
    openScroll.current = false
    return take
  }
  // Leaving override mode (from the strip, or another screen) closes the
  // editor; a save in flight finishes first.
  if (editing && !saving && isCommish && pastScheduled && !storeMode) setEditing(false)

  // Re-seed the editor from the persisted settings whenever they change.
  const baselineKey = JSON.stringify({ s: detail.settings, sid: detail.league.scoring_system_id, st: status })

  if (editing) {
    return (
      <SettingsEditScreen
        key={baselineKey}
        leagueId={leagueId}
        detail={detail}
        page={page}
        canEdit={canEdit}
        inSeason={inSeasonOverride && policies.data !== undefined ? { policies: policies.data, saving, onSave: saveInSeason } : null}
        saving={saving}
        anchor={page === 'general' ? generalGroupFor(section) : null}
        takeOpenScroll={takeOpenScroll}
        onClose={() => {
          setEditing(false)
          // The read page opens at its top — where a mid-season save's
          // results are.
          scrollToTop(document.querySelector('[data-settings-editing]'))
        }}
      />
    )
  }

  const header = (
    <LeaguePageBar
      leagueId={leagueId}
      title={PAGE_TITLES[page]}
      action={
        showEdit ? (
          <MPageBarAction
            onClick={() => {
              setResults([])
              openScroll.current = true
              setEditing(true)
            }}
            disabled={!canEdit}
            data-settings-edit
          >
            Edit
          </MPageBarAction>
        ) : undefined
      }
    />
  )

  return (
    <MobileScreen header={header}>
      <div className="flex flex-col gap-[18px] px-4 pb-8 pt-2" data-league-settings={page}>
        {isCommish && pastScheduled && (
          <OverrideCard
            on={inSeasonOverride}
            policyState={!inSeasonOverride ? 'idle' : policies.isPending ? 'loading' : policies.isError ? 'error' : 'ready'}
            onRetry={() => void policies.refetch()}
            onTurnOn={() => {
              setResults([])
              enterOverride(leagueId)
            }}
          />
        )}
        {(saving || results.length > 0) && <SaveResults saving={saving} results={results} />}
        {page === 'general' && <GeneralPage leagueId={leagueId} detail={detail} isCommish={isCommish} anchor={generalGroupFor(section)} />}
        {page === 'playoffs' && <PlayoffsRows settings={detail.settings} />}
        {page === 'scoring' && <ScoringPage leagueId={leagueId} detail={detail} />}
        {!isCommish && <p className="text-center text-[11px] font-medium text-m-t3">{MEMBER_FOOTER}</p>}
      </div>
    </MobileScreen>
  )
}

// ---------------------------------------------------------------------------
// The rows (handoff G2)
// ---------------------------------------------------------------------------

const ROW = 'flex min-h-[44px] items-center gap-3 border-b border-m-b2 py-2.5'
const LABEL = 'min-w-0 flex-1 text-[14px] font-medium text-m-t1'
const VALUE = 'max-w-[62%] text-balance text-right text-[14px] font-semibold text-m-t1'

function Row({ row, onOpen }: { row: SettingsRow; onOpen?: () => void }) {
  if ('handles' in row) {
    return (
      <div className={ROW} data-settings-row={row.key}>
        <span className={LABEL}>{row.label}</span>
        <span className={VALUE}>
          {row.handles.map((h, i) => (
            <span key={h}>
              {i > 0 && ', '}
              <UsernameLink username={h} />
            </span>
          ))}
        </span>
      </div>
    )
  }
  if ('href' in row) {
    return (
      <Link href={row.href} className={cn(ROW, 'active:bg-m-b1')} data-settings-row={row.key}>
        <span className={LABEL}>{row.label}</span>
        {row.value && <span className={cn(VALUE, 'font-medium text-m-t3')}>{row.value}</span>}
        <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
      </Link>
    )
  }
  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={cn(ROW, 'w-full text-left active:bg-m-b1')} data-settings-row={row.key}>
        <span className={LABEL}>{row.label}</span>
        <span className={VALUE}>{row.value}</span>
        <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
      </button>
    )
  }
  return (
    <div className={ROW} data-settings-row={row.key}>
      <span className={LABEL}>{row.label}</span>
      <span className={VALUE}>{row.value}</span>
    </div>
  )
}

function Group({ group, open }: { group: SettingsGroup; open?: Partial<Record<string, () => void>> }) {
  return (
    <section className="flex scroll-mt-[60px] flex-col" id={`settings-group-${group.id}`} data-settings-group={group.id}>
      <h2 className="pb-1 pt-2.5 text-[13px] font-semibold text-m-t3">{group.title}</h2>
      {group.rows.map((row) => (
        <Row key={row.key} row={row} onOpen={open?.[row.key]} />
      ))}
    </section>
  )
}

function RowsPage({ groups, note }: { groups: readonly SettingsGroup[]; note?: string }) {
  return (
    <>
      {groups.map((g) => (
        <Group key={g.id} group={g} />
      ))}
      {note && <p className="rounded-message bg-m-b1 p-3 text-[12px] font-medium leading-[1.45] text-m-t2">{note}</p>}
    </>
  )
}

function PlayoffsRows({ settings }: { settings: LeagueDetail['settings'] }) {
  const { groups, note } = playoffsPage(settings)
  return <RowsPage groups={groups} note={note} />
}

function GeneralPage({
  leagueId,
  detail,
  isCommish,
  anchor,
}: {
  leagueId: string
  detail: LeagueDetail
  isCommish: boolean
  anchor: string | null
}) {
  const [profileOpen, setProfileOpen] = useState(false)
  const leagues = useLeagues()
  const index = Math.max(0, leagues.data?.findIndex((l) => l.id === leagueId) ?? 0)
  const groups = generalGroups({
    name: detail.league.name,
    season: detail.league.season,
    settings: detail.settings,
    members: detail.members,
    formatDraftAt: formatDraftInstant,
    membersHref: membersPageHref(leagueId),
  })
  // An address that names a group (the setup checklist's "draft time", the
  // console's "Draft settings") opens the page at it.
  useEffect(() => {
    if (anchor) document.getElementById(`settings-group-${anchor}`)?.scrollIntoView({ block: 'start' })
  }, [anchor])
  return (
    <>
      {groups.map((g) => (
        <Group key={g.id} group={g} open={isCommish && g.id === 'league' ? { name: () => setProfileOpen(true) } : undefined} />
      ))}
      {isCommish && (
        <section className="flex flex-col" data-settings-group="commish">
          <h2 className="pb-1 pt-2.5 text-[13px] font-semibold text-m-t3">Commissioner</h2>
          <Link href={commishConsoleHref(leagueId)} className="flex min-h-[52px] items-center gap-3 border-b border-m-b2 py-2.5 active:bg-m-b1" data-door="commish">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14px] font-medium text-m-t1">{COMMISH_ROW_TITLE}</span>
              <span className="text-[12px] font-medium leading-[1.35] text-m-t3">{COMMISH_ROW_NOTE}</span>
            </span>
            <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
          </Link>
        </section>
      )}
      {isCommish && (
        <LeagueProfileSheet
          open={profileOpen}
          onOpenChange={setProfileOpen}
          leagueId={leagueId}
          name={detail.league.name}
          avatarUrl={detail.league.avatar_url}
          tileClass={leagueAvClass(index)}
        />
      )}
    </>
  )
}

/**
 * Scoring (handoff G2 "scoring"): which rulebook, then every value the
 * league pays. The values are the league's own document — the frozen copy
 * once the draft has run, the live rulebook before — so a member reads
 * exactly what the season scores with.
 */
function ScoringPage({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const templates = useScoringTemplates()
  const scoring = useLeagueScoringFamily(leagueId)
  const sid = detail.league.scoring_system_id
  const templateIds = templates.data?.map((t) => t.id)
  const custom = templateIds !== undefined && isCustomScoringReference(sid, templateIds)
  const templateName = templates.data?.find((t) => t.id === sid)?.name ?? null
  const parsed = scoring.data == null ? null : scoringRulesDocSchema.safeParse(scoring.data)
  // A failed read of the templates never reads as "not set".
  const rulebook = templates.isPending ? 'Reading…' : templates.isError ? 'Couldn’t load' : custom ? 'The league’s own' : (templateName ?? 'Not set')
  return (
    <>
      <section className="flex flex-col" data-settings-group="rulebook">
        <h2 className="pb-1 pt-2.5 text-[13px] font-semibold text-m-t3">Rulebook</h2>
        <Row row={{ key: 'rulebook', label: 'Scoring', value: rulebook }} />
      </section>
      {scoring.isPending ? (
        <SettingsSkeleton blocks={['row', 'row', 'row', 'row']} />
      ) : scoring.isError && scoring.data === undefined ? (
        <CenteredNote role="alert" message="Couldn’t load the scoring values." action="Try again" onAction={() => void scoring.refetch()} />
      ) : !parsed ? (
        <CenteredNote message="This league has no scoring set yet." />
      ) : !parsed.success ? (
        <CenteredNote role="alert" message="This league’s scoring can’t be read." />
      ) : (
        <RowsPage groups={scoringGroups(parsed.data)} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Commissioner: the override switch and the per-key results
// ---------------------------------------------------------------------------

/**
 * Past the draft, a commissioner's settings lock (§7.1); THE override switch
 * (the store the team and match screens read — never a page-local toggle)
 * opens the ones that can still change. Off: what the mode does and the
 * pill to turn it on. On: the league screens' green strip says so (with
 * Turn off); this card only carries the read of what can change — loading,
 * or failed with Try again (a failed read is never "locked").
 */
function OverrideCard({
  on,
  policyState,
  onRetry,
  onTurnOn,
}: {
  on: boolean
  policyState: 'idle' | 'loading' | 'error' | 'ready'
  onRetry: () => void
  onTurnOn: () => void
}) {
  if (!on) {
    return (
      <div className="flex flex-col items-start gap-2.5 rounded-message bg-m-b1 px-3.5 py-3" data-settings-override="off">
        <p className="text-[13px] font-medium leading-[1.45] text-m-t2">{SETTINGS_OVERRIDE_BAR_OFF_COPY}</p>
        <button
          type="button"
          onClick={onTurnOn}
          className="flex h-9 items-center rounded-pill bg-accent px-4 text-[13px] font-semibold text-white active:bg-accent-strong"
          data-override-toggle="off"
        >
          Turn on override mode
        </button>
      </div>
    )
  }
  if (policyState === 'loading') {
    return (
      <p role="status" className="rounded-message bg-m-b1 px-3 py-2.5 text-[13px] font-medium text-m-t3" data-settings-override="loading">
        {SETTINGS_POLICY_LOADING_COPY}
      </p>
    )
  }
  if (policyState === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-message bg-m-gr px-3 py-2.5" data-settings-override="error">
        <p className="text-[13px] font-medium leading-[1.4] text-m-tr">{SETTINGS_POLICY_PROBLEM_COPY}</p>
        <button type="button" onClick={onRetry} className="flex h-8 items-center rounded-pill bg-m-b0 px-3.5 text-[13px] font-semibold text-m-t1 active:bg-m-b2">
          Try again
        </button>
      </div>
    )
  }
  return null
}

const RESULT_TONE: Record<'positive' | 'caution' | 'neutral', string> = {
  positive: 'bg-m-gg text-m-tg',
  caution: 'bg-m-go text-m-to',
  neutral: 'bg-m-b1 text-m-t2',
}

/** One line per setting the last mid-season save sent — 129's outcome
 *  (never a bare "saved"), or its refusal word for word. */
function SaveResults({ saving, results }: { saving: boolean; results: readonly SettingSaveResult[] }) {
  return (
    <div className="flex flex-col gap-1.5" data-setting-results>
      {saving && (
        <p role="status" className="text-[12px] font-medium text-m-t3">
          Saving — one recorded change per setting…
        </p>
      )}
      {results.map((r) =>
        r.ok ? (
          <p key={r.key} role="status" className={cn('rounded-message px-3 py-2.5 text-[13px] font-medium leading-[1.4]', RESULT_TONE[r.outcome.tone])} data-setting-result={r.key}>
            {r.outcome.text}
            {r.outcome.branch !== 'no_changes' && r.bypassed.length > 0 && (
              <span className="mt-0.5 block text-[12px] opacity-80">{`This change walked past: ${r.bypassed.join(', ')}.`}</span>
            )}
          </p>
        ) : (
          <p key={r.key} role="alert" className="rounded-message bg-m-gr px-3 py-2.5 text-[13px] font-medium leading-[1.4] text-m-tr" data-setting-result={r.key}>
            {`${r.key.replace(/_/g, ' ')}: not saved — ${r.refusal}`}
          </p>
        ),
      )}
    </div>
  )
}
