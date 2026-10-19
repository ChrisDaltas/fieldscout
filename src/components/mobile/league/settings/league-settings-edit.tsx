'use client'

import { useEffect, useRef, useState } from 'react'

import { ScoringEditor } from '@/components/leagues/scoring-editor'
import { scoringEditorAccess } from '@/components/leagues/scoring-editor-ops'
import { InlineIssue, SettingsSkin } from '@/components/leagues/settings-form-controls'
import {
  DraftSettingsGroups,
  FormatGroup,
  RosterSettingsGroups,
  SCORING_EDITOR_ANCHOR_ID,
  ScoringPickGroup,
  TiebreakersGroup,
  TradesGroup,
  useLeaveGuard,
  useSettingsForm,
  WaiversGroup,
  type InSeasonArm,
  type SettingsFormModel,
} from '@/components/leagues/settings-panel'
import { SETTINGS_OVERRIDE_BAR_ON_COPY } from '@/components/leagues/settings-panel-ops'
import { LeaguePageBar } from '@/components/mobile/league/league/league-bits'
import { MobileScreen, MPageBarAction } from '@/components/mobile/ui/mobile-header'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import type { LeagueDetail } from '@/hooks/use-league'

import { PAGE_TITLES, type GeneralGroupId, type SettingsPage } from './league-settings-ops'

/**
 * A League settings page in edit mode (gap list §4 item 105) — what a
 * commissioner sees after Edit. The page's settings as the SAME form groups
 * desktop's settings page draws (`FormatGroup`, the roster builder, the
 * draft groups, waivers, trades, tiebreakers, the scoring picker and the
 * custom scoring editor), in their phone skin (`SettingsSkin` mobile), over
 * the same model (`useSettingsForm`): one atomic PATCH before the draft, one
 * recorded `commish_change_setting` per setting after it (with keys that
 * can't change mid-season closed, in the server's words). No reason is
 * asked.
 *
 * The bar holds Cancel and Save (iOS's edit pattern); a line under it says
 * what Save will do — or why it can't yet (prevent, don't refuse). Cancel
 * with changes asks first; so does leaving the page by a link or a reload
 * (desktop's `useLeaveGuard`). The custom scoring editor keeps its own Save
 * for its values, as on desktop.
 */
export function SettingsEditScreen({
  leagueId,
  detail,
  page,
  canEdit,
  inSeason,
  saving,
  anchor = null,
  onClose,
}: {
  leagueId: string
  detail: LeagueDetail
  page: SettingsPage
  canEdit: boolean
  inSeason: InSeasonArm | null
  /** A mid-season save is running (it lives above this screen). */
  saving: boolean
  /** League settings' group to open at (the address named it). */
  anchor?: GeneralGroupId | null
  onClose: () => void
}) {
  const form = useSettingsForm({ leagueId, detail, canEdit, inSeason })
  const leave = useLeaveGuard(form.unsaved)
  const [discard, setDiscard] = useState(false)
  const busy = form.isPending || saving

  const bodyRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const target = anchor ? document.getElementById(`settings-edit-${anchor}`) : null
    if (target) target.scrollIntoView({ block: 'start' })
    else scrollToTop(bodyRef.current)
    // Once, as the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cancel = () => (form.unsaved ? setDiscard(true) : onClose())
  const save = async () => {
    if (await form.handleSave()) onClose()
  }

  const header = (
    <LeaguePageBar
      leagueId={leagueId}
      title={PAGE_TITLES[page]}
      leading={
        <MPageBarAction tone="quiet" onClick={cancel} data-settings-cancel>
          Cancel
        </MPageBarAction>
      }
      action={
        <MPageBarAction onClick={() => void save()} disabled={!form.canSubmit} data-settings-save>
          {busy ? 'Saving…' : 'Save'}
        </MPageBarAction>
      }
    />
  )

  return (
    <MobileScreen header={header}>
      <SettingsSkin layout="mobile">
        <div ref={bodyRef} className="flex flex-col gap-[18px] px-4 pb-8 pt-3" data-settings-editing={page}>
          <p className="text-[12px] font-medium leading-[1.4] text-m-t3" role="status" data-save-summary>
            {saveSummary(form, inSeason !== null)}
          </p>
          <EditNotices form={form} />
          {/* `disabled` closes every control in one place if editing stops
              being allowed while the screen is open (the draft starting). */}
          <fieldset disabled={!canEdit} className="m-0 flex min-w-0 flex-col gap-[18px] border-0 p-0" data-settings-fieldset={canEdit ? 'open' : 'closed'}>
            {page === 'general' && (
              <>
                <div id="settings-edit-league" className="scroll-mt-[60px]">
                  <FormatGroup s={form.working} onSettings={form.updateSettings} errorsFor={form.errorsFor} refusedFor={form.refusedFor} part="basics" />
                </div>
                <div id="settings-edit-roster" className="flex scroll-mt-[60px] flex-col gap-[18px]">
                  <RosterSettingsGroups form={form} />
                </div>
                <div id="settings-edit-draft" className="flex scroll-mt-[60px] flex-col gap-[18px]">
                  <DraftSettingsGroups form={form} leagueId={leagueId} detail={detail} canEdit={canEdit} />
                </div>
                <div id="settings-edit-waivers" className="flex scroll-mt-[60px] flex-col gap-[18px]">
                  <WaiversGroup s={form.working} onSettings={form.updateSettings} />
                  <TradesGroup s={form.working} onSettings={form.updateSettings} errorsFor={form.errorsFor} />
                </div>
              </>
            )}
            {page === 'playoffs' && (
              <>
                <FormatGroup s={form.working} onSettings={form.updateSettings} errorsFor={form.errorsFor} refusedFor={form.refusedFor} part="playoffs" />
                <TiebreakersGroup s={form.working} onSettings={form.updateSettings} />
              </>
            )}
            {page === 'scoring' && <ScoringPickGroup form={form} detail={detail} canEdit={canEdit} inSeason={inSeason} />}
          </fieldset>
          {/* The custom values editor saves on its own (its own PUT), so it
              sits outside the form — and only while those values can still
              change (setup / scheduled); after that the page's rows show
              them. */}
          {page === 'scoring' && scoringEditorAccess(detail.my_role, detail.league.status).inEditWindow && (
            <div id={SCORING_EDITOR_ANCHOR_ID} className="scroll-mt-[60px]">
              <ScoringEditor leagueId={leagueId} />
            </div>
          )}
        </div>
      </SettingsSkin>

      <ConfirmLeaveSheet
        open={discard}
        title="Discard changes?"
        subtitle="Your changes to these settings haven’t been saved."
        leaveLabel="Discard"
        onStay={() => setDiscard(false)}
        onLeave={() => {
          setDiscard(false)
          onClose()
        }}
      />
      <ConfirmLeaveSheet
        open={leave.href !== null}
        title="Leave without saving?"
        subtitle="You have unsaved settings changes. If you leave now, they’re lost."
        leaveLabel="Leave"
        onStay={leave.onStay}
        onLeave={leave.onLeave}
      />
    </MobileScreen>
  )
}

/** Back to the top of the screen — the phone shell scrolls its `<main>`,
 *  not the window. */
export function scrollToTop(from: Element | null) {
  const scroller = from?.closest('main')
  if (scroller) scroller.scrollTo({ top: 0 })
  else window.scrollTo({ top: 0 })
}

/** The line under the bar: what Save will do, or why it can't yet. */
export function saveSummary(form: Pick<SettingsFormModel, 'plan' | 'dirty' | 'validation'>, inSeason: boolean): string {
  if (form.plan) {
    const n = form.plan.send.length
    if (n > 0) return `${n} setting${n === 1 ? '' : 's'} to save — each is recorded and posted to the league.`
    return inSeason ? SETTINGS_OVERRIDE_BAR_ON_COPY : 'Change a setting, then Save.'
  }
  if (!form.dirty) return 'Change a setting, then Save.'
  const fix = form.validation.errors.length
  return fix > 0 ? `${fix} to fix before you can save.` : 'Unsaved changes — Save keeps them.'
}

/** Every current problem, above the groups: the contract's own messages
 *  (an edit on one page can break a value on another), a refused save, and
 *  a mid-season change that can't be sent — never dropped silently. */
function EditNotices({ form }: { form: SettingsFormModel }) {
  const { errorList, serverError, plan } = form
  return (
    <>
      {errorList.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 rounded-message bg-m-gr px-3 py-2.5" data-settings-errors>
          {errorList.map((e) => (
            <li key={`${e.section}:${e.message}`} className="text-[13px] font-medium leading-[1.4] text-m-tr" data-settings-error={e.section}>
              {e.message}
            </li>
          ))}
        </ul>
      )}
      {serverError && (serverError.status === 403 || serverError.status === 409) && <InlineIssue tone="error" message={serverError.message} />}
      {plan?.refused.map((r) => (
        <div key={r.key} data-refused-change={r.key}>
          <InlineIssue tone="warning" message={`${r.key.replace(/_/g, ' ')} was changed but can’t change mid-season, so it won’t be saved — ${r.why}`} />
        </div>
      ))}
    </>
  )
}

/** Keep editing / leave — the phone's ask before unsaved changes go (the
 *  Lists editor's "Discard changes?" sheet). */
function ConfirmLeaveSheet({
  open,
  title,
  subtitle,
  leaveLabel,
  onStay,
  onLeave,
}: {
  open: boolean
  title: string
  subtitle: string
  leaveLabel: string
  onStay: () => void
  onLeave: () => void
}) {
  return (
    <MobileSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onStay()
      }}
      title={title}
      subtitle={subtitle}
      footer={
        <div className="flex flex-col gap-2 px-4 pb-[max(30px,env(safe-area-inset-bottom))] pt-1">
          <button type="button" onClick={onStay} className="flex h-12 items-center justify-center rounded-[14px] bg-accent text-[15px] font-semibold text-white active:bg-accent-strong">
            Keep editing
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="flex h-12 items-center justify-center rounded-[14px] bg-m-b2 text-[15px] font-semibold text-m-red active:bg-m-b2h"
            data-settings-leave
          >
            {leaveLabel}
          </button>
        </div>
      }
    >
      <span className="sr-only">Leaving now drops the settings changes you haven’t saved.</span>
    </MobileSheet>
  )
}
