'use client'

import { useId, useState } from 'react'

import { renameGate, renameOutcome, type RenameGate } from '@/components/leagues/team-commish-ops'
import { TeamAvatar } from '@/components/mobile/league/team/team-avatar'
import { teamOrder } from '@/components/mobile/league/team/team-ops'
import { MOverlay, MOverlayScroll } from '@/components/mobile/trades/m-overlay'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { useLeague } from '@/hooks/use-league'
import { useRenameOwnTeam } from '@/hooks/use-rename-own-team'
import { toast } from '@/hooks/use-toast'
import type { RenameOwnTeamResult } from '@/lib/leagues/api/team-rename-service'
import { cn } from '@/lib/utils'

/** The handoff's limit for a name typed here (G1 "My team": `maxlength=24`,
 *  the "n / 24" counter). Desktop and the server allow 100 — which limit
 *  applies on both is an open question for Chris; until then the phone
 *  keeps the design's 24 for a name you change here. */
export const MY_TEAM_NAME_MAX = 24

/** Said when a changed name runs past 24. True for the phone only: it is not
 *  a rule for team names (a longer name set on desktop is legal). */
export const MY_TEAM_NAME_TOO_LONG = `Names on the phone can be up to ${MY_TEAM_NAME_MAX} characters — shorten it to save.`

export type MyTeamSave = RenameGate | { ok: false; why: null }

/**
 * Whether Save is on (G1's dirty check, without the prototype's bug of
 * enabling on added spaces): the trimmed name must be there, within the
 * phone's 24, and differ from the team's name now. `why` says what is wrong;
 * null is "nothing changed yet" — the greyed Save says that on its own. An
 * untouched name is never an error, even one longer than 24 set on desktop.
 */
export function myTeamSave(draft: string, current: string): MyTeamSave {
  if (draft.trim() === current) return { ok: false, why: null }
  const gate = renameGate(draft)
  if (gate.ok && gate.name.length > MY_TEAM_NAME_MAX) return { ok: false, why: MY_TEAM_NAME_TOO_LONG }
  return gate
}

/** The toast after a save: the design's "Team updated", plus a line when
 *  another team in the league already has that name (the server allows it
 *  and says so — desktop says it too). */
export function myTeamSavedToast(result: Pick<RenameOwnTeamResult, 'no_changes' | 'name' | 'name_collides_with'>): {
  title: string
  description?: string
} {
  const said = renameOutcome(result, false)
  if (said.branch === 'no_changes') return { title: `Your team is already called ${result.name}` }
  if (said.branch === 'renamed_name_shared') return { title: 'Team updated', description: 'Another team in this league has the same name.' }
  return { title: 'Team updated' }
}

/**
 * League Menu › My team (handoff G1; gap list §3 #10): rename your own team.
 * The desktop's manager door — `rename_own_team` through
 * `POST /api/leagues/[id]/teams/[tid]/name` (`useRenameOwnTeam`): no reason,
 * not recorded, not posted. A full-screen page over the screen you opened
 * the Menu on; Back closes it and leaves you there.
 *
 * The design's "Upload photo" and "Avatar color" are left out: teams have no
 * photo or colour yet (gap list §2, "Team colour or photo"). The avatar shows
 * your team's colour and the first letter of the name as you type it.
 */
export function MyTeamPage({ leagueId, teamId, onClose }: { leagueId: string; teamId: string; onClose: () => void }) {
  const detail = useLeague(leagueId)
  const teams = detail.data?.teams
  const team = teams?.find((t) => t.id === teamId) ?? null

  return (
    <MOverlay label="My team" onClose={onClose}>
      <div className="flex h-[52px] flex-none items-center gap-2 border-b border-m-b3 px-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="flex size-9 flex-none items-center justify-center rounded-full text-accent active:bg-m-b2"
          data-my-team-back
        >
          <MIcon name="back" size={18} stroke={2} />
        </button>
        <span className="flex-1 text-center text-[16px] font-semibold text-m-t1">My team</span>
        <span className="w-9 flex-none" aria-hidden />
      </div>
      <MOverlayScroll className="pb-8">
        {team && teams ? (
          <MyTeamForm key={team.id} leagueId={leagueId} teamId={team.id} currentName={team.name} order={teamOrder(teams)} onDone={onClose} />
        ) : detail.isPending ? (
          <div className="flex flex-col items-center gap-6 px-4 py-6" aria-busy="true" data-my-team="loading">
            <span className="size-24 rounded-full bg-m-b1" />
            <span className="h-12 w-full rounded-[12px] bg-m-b1" />
            <span className="h-12 w-full rounded-pill bg-m-b1" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="alert" data-my-team="error">
            <p className="text-[14px] font-medium text-m-t3">{detail.isError ? 'Couldn’t load your team.' : 'Your team isn’t in this league anymore.'}</p>
            {detail.isError && (
              <button type="button" onClick={() => void detail.refetch()} className="h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold text-m-t1 active:bg-m-b2h">
                Try again
              </button>
            )}
          </div>
        )}
      </MOverlayScroll>
    </MOverlay>
  )
}

/** The form itself — the draft starts from the team's name each time the
 *  page opens (G1 seeds `draftName` on open). Not optimistic: the name the
 *  app shows after Save is the server's, re-read by the hook. */
export function MyTeamForm({
  leagueId,
  teamId,
  currentName,
  order,
  onDone,
}: {
  leagueId: string
  teamId: string
  currentName: string
  /** The league's team ids in league order (the avatar palette's anchor). */
  order: readonly string[]
  onDone: () => void
}) {
  const id = useId()
  const rename = useRenameOwnTeam(leagueId, teamId)
  const [draft, setDraft] = useState(currentName)
  const save = myTeamSave(draft, currentName)
  const why = save.ok ? null : save.why
  const pending = rename.isPending
  const refusal = rename.error?.message ?? null
  // Red only once a changed name is over — never on the name as it opens.
  const tooLong = why === MY_TEAM_NAME_TOO_LONG

  return (
    <form
      className="flex flex-col gap-6 px-4 py-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (!save.ok || pending) return
        rename.mutate(
          { name: save.name },
          {
            onSuccess: (result) => {
              toast(myTeamSavedToast(result))
              onDone()
            },
          },
        )
      }}
      data-my-team-form
    >
      <div className="flex flex-col items-center gap-3">
        <TeamAvatar teamId={teamId} name={draft.trim() || currentName} teamIds={order} myTeamId={teamId} size={96} fontSize={36} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-name`} className="text-[13px] font-semibold text-m-t3">
          Team name
        </label>
        <input
          id={`${id}-name`}
          value={draft}
          maxLength={MY_TEAM_NAME_MAX}
          autoComplete="off"
          enterKeyHint="done"
          disabled={pending}
          aria-describedby={`${id}-count${why ? ` ${id}-why` : ''}`}
          onChange={(event) => {
            setDraft(event.target.value)
            if (rename.isError) rename.reset()
          }}
          className="h-12 rounded-[12px] border-0 bg-m-b2 px-3.5 font-sans text-[16px] font-semibold text-m-t1 outline-none disabled:opacity-60"
          data-my-team-input
        />
        <span id={`${id}-count`} className={cn('text-[11px] font-medium', tooLong ? 'text-m-tr' : 'text-m-t3')} data-my-team-count>
          {draft.length} / {MY_TEAM_NAME_MAX}
        </span>
        {why && (
          <span id={`${id}-why`} className="text-[12px] font-medium text-m-t3" data-my-team-why>
            {why}
          </span>
        )}
      </div>
      {refusal && (
        <p role="alert" className="rounded-[12px] bg-m-gr px-3 py-2 text-[13px] font-medium text-m-tr" data-my-team-refusal>
          {refusal}
        </p>
      )}
      <button
        type="submit"
        disabled={!save.ok || pending}
        className={cn(
          'flex h-12 w-full items-center justify-center rounded-pill text-[15px] font-semibold',
          save.ok ? 'bg-accent text-white active:bg-accent-strong' : 'bg-m-b3s text-m-t3',
        )}
        data-my-team-save
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
