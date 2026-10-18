'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'

import {
  M_TEXT_FIELD,
  MChoiceChip,
  MField,
  MRadioCard,
  MStepProgress,
  MWizardFooter,
} from '@/components/mobile/ui/m-form'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { LayoutMode } from '@/hooks/use-layout-mode'
import { toast } from '@/hooks/use-toast'
import { useLeagueLists } from '@/hooks/use-league-lists'
import { useCreateLeague } from '@/hooks/use-leagues'
import { useScoringTemplates } from '@/hooks/use-scoring-templates'
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import { AttachListInline } from './attach-list-modal'
import {
  initialWizardDraft,
  reconcileDerived,
  toCreateInput,
  type WizardDraft,
} from './league-create-wizard-ops'
import { ChoiceSelect, numOptions, SettingsSkin, useSettingsSkin } from './settings-form-controls'
import { ScoringTemplatePicker } from './scoring-template-picker'
import { WaiverScheduleFields } from './waiver-schedule-fields'
import {
  effectiveTemplateSelection,
  resolveDefaultTemplateId,
} from './scoring-template-picker-ops'

/**
 * Create-league modal — the 3-step replacement for the /leagues/new page
 * wizard (Chris, 2026-08-03). Same data spine as before (no fork): the
 * `WizardDraft` + `toCreateInput` ops module and the `useCreateLeague`
 * hook → create_league RPC. Everything not asked here keeps its §7.3
 * default and is editable afterwards in the settings panel — which is why
 * every step leads with the "you can change this later" line.
 *
 *   1. Basics    — name, optional avatar, team count
 *   2. Style     — draft type (snake/auction) + scoring style (PPR/no-PPR;
 *                  opens on No PPR — RULED, Chris 2026-09-01: Scout
 *                  Standard is the default selected template, and its
 *                  family's view is where it is visible — SC.4/App B.5.1)
 *   3. Template  — pick a scoring template (filtered by the style pick;
 *                  each family opens with its own Scout preselected —
 *                  No PPR → Scout Standard, PPR → Scout PPR, per §7.3.3's
 *                  system-default bullet — a derived preselection the
 *                  user's explicit pick always beats, never a silent write)
 *
 * The bottom stepper moves freely between steps (no gating between
 * sections; only Create validates). The avatar can't upload before the
 * league exists (the storage path is keyed by league id), so the file is
 * held locally and posted to /api/leagues/[id]/profile right after create.
 *
 * `layout="mobile"` (the phone's Home, gap list §4 item 2) renders the same
 * draft, steps, create call and success step as a FieldScout Mobile bottom
 * sheet: the step bodies draw in the phone language through `SettingsSkin`,
 * Back / Continue replace the stepper (Basics holds Continue until the
 * league has a name), and the sheet follows the phone's light or dark
 * theme. Creating a league stays free.
 */

const STEPS = ['Basics', 'Draft & scoring', 'Scoring template'] as const
/** The success step's offer line (desktop description, phone subtitle). */
const CREATED_LINE =
  'Invite your managers from the league home. Want your rankings along? Attach a list now — it’s one tap away in the draft room and can feed your autopick.'
/** §7.3.1's offered league sizes (the Basics step's choice). */
const TEAM_COUNTS = [8, 10, 12, 14, 16] as const

export function LeagueCreateModal({
  open,
  onOpenChange,
  layout = 'desktop',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  layout?: LayoutMode
}) {
  const mobile = layout === 'mobile'
  const router = useRouter()
  const [draft, setDraft] = useState<WizardDraft>(initialWizardDraft)
  const [step, setStep] = useState(0)
  // SC.4 (§7.3.3's system-default bullet, v2.16.11): each style family
  // preselects its OWN Scout — No PPR → Scout Standard, PPR → Scout PPR —
  // so neither side of the style step hides a default (D282(3) dissolved).
  // The OPENING side is RULED (Chris, 2026-09-01, verbatim: "Scout Standard
  // should be the default selected template."): Scout Standard preselected
  // ⇒ the style step opens on No PPR, its own family — the preselected
  // card must be visible (a selection the user can't see is the CLAUDE.md
  // "nothing happened" shape).
  const [scoringStyle, setScoringStyle] = useState<'ppr' | 'no_ppr'>('no_ppr')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // The SUCCESS step (M2 L.B4.2): §7.4's "the league-create wizard also
  // offers to attach existing lists" — after create the modal shows the
  // attach offer instead of closing straight into navigation.
  const [created, setCreated] = useState<{
    id: string
    name: string
    scoringSystemId: string | null
  } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const { createLeagueAsync } = useCreateLeague()

  // SC.4 — the §7.3.3 default, as a pure DERIVATION (no effect, no draft
  // write): the ACTIVE family's Scout id resolved by natural key from the
  // fetched template rows (No PPR → Scout Standard, PPR → Scout PPR — the
  // v2.16.11 family law), so the default always points at a card the active
  // view shows. The user's explicit pick always wins
  // (`effectiveTemplateSelection` — explicit ?? default), and a missing
  // Scout row degrades loudly to the explicit-pick flow
  // (`resolveDefaultTemplateId` warns, naming the absent half; the create
  // button stays disabled with the designed "Pick a scoring template" line
  // below).
  const templatesQuery = useScoringTemplates({ enabled: open })
  const defaultTemplateId = useMemo(
    () => resolveDefaultTemplateId(templatesQuery.data, scoringStyle),
    [scoringStyle, templatesQuery.data],
  )
  const effectiveScoringId = effectiveTemplateSelection(
    draft.scoringSystemId,
    defaultTemplateId,
  )

  // The success step's live attached set: `useAttachList`'s onSettled
  // invalidation refetches it, so a second attach sees the first flagged.
  const createdLists = useLeagueLists(created?.id ?? '', Boolean(created))
  const createdAttachedIds = useMemo(
    () => new Set((createdLists.data ?? []).map((row) => row.list_id)),
    [createdLists.data],
  )

  const updateSettings = (patch: Partial<LeagueSettings>) =>
    setDraft((prev) => ({
      ...prev,
      settings: reconcileDerived(prev.settings, { ...prev.settings, ...patch }),
    }))

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return
    onOpenChange(next)
    if (!next) {
      // Closing after a successful create always lands on the new league —
      // the pre-success-step behavior (create → navigate), kept for every
      // dismissal path (X, outside click, Go to league).
      if (created) router.push(`/app/leagues/${created.id}`)
      // Reset for the next open — a closed modal is a discarded draft.
      setDraft(initialWizardDraft())
      setStep(0)
      setScoringStyle('no_ppr') // back to the ruled opening side (SC.4)
      setAvatarFile(null)
      if (avatarPreview) URL.revokeObjectURL(avatarPreview)
      setAvatarPreview(null)
      setCreated(null)
    }
  }

  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (avatarPreview) URL.revokeObjectURL(avatarPreview)
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  function handleScoringStyle(style: 'ppr' | 'no_ppr') {
    if (style === scoringStyle) return
    setScoringStyle(style)
    // The style narrows step 3's template list — a previously picked
    // template may no longer be offered, so the pick resets with it. The
    // SC.3 review's swap hazard (a reset-refill silently substituting a
    // different card for an explicit pick) retired BY DESIGN at v2.16.11:
    // the refill now lands on the active family's own Scout — the intended
    // default for that view, never a surprise substitution (D284(3)).
    setDraft((p) => ({ ...p, scoringSystemId: null }))
  }

  const nameMissing = draft.name.trim().length === 0
  const input = toCreateInput(draft, defaultTemplateId)
  const canCreate = input !== null && !submitting

  async function handleCreate() {
    if (input === null || submitting) return
    setSubmitting(true)
    try {
      const result = await createLeagueAsync(input)
      if (avatarFile) {
        // League exists — the avatar path is keyed by its id. A failed
        // upload shouldn't strand the freshly created league: warn and move on.
        const form = new FormData()
        form.append('file', avatarFile)
        const response = await fetch(`/api/leagues/${result.league_id}/profile`, {
          method: 'POST',
          body: form,
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: unknown } | null
          toast({
            title: "League created, but the avatar didn't upload",
            description:
              typeof body?.error === 'string'
                ? `${body.error} You can add it in League settings.`
                : 'You can add it in League settings.',
          })
        }
      }
      // Flip to the success step (§7.4's attach offer) instead of closing;
      // every close path from here navigates to the league (handleOpenChange).
      setCreated({
        id: result.league_id,
        name: draft.name.trim(),
        // The id the league was actually CREATED with — the effective
        // choice the payload carried (explicit pick or the Scout default),
        // not the draft's explicit-only field (SC.3).
        scoringSystemId: input.scoring_system_id,
      })
    } catch (cause) {
      toast({
        title: "Couldn't create the league",
        description: cause instanceof Error ? cause.message : 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // The step body — ONE body for both layouts; the desktop dialog and the
  // phone sheet differ only in their chrome (header, stepper, footer).
  const stepBody = (
    <>
      <ChangeLaterNote />

      {step === 0 && (
        <BasicsStep
          draft={draft}
          nameMissing={nameMissing}
          avatarPreview={avatarPreview}
          onName={(name) => setDraft((p) => ({ ...p, name }))}
          onTeamCount={(team_count) => updateSettings({ team_count })}
          onPickAvatar={() => fileRef.current?.click()}
          onRemoveAvatar={() => {
            setAvatarFile(null)
            if (avatarPreview) URL.revokeObjectURL(avatarPreview)
            setAvatarPreview(null)
          }}
        />
      )}

      {step === 1 && (
        <StyleStep
          draftType={draft.settings.draft.draft_type}
          scoringStyle={scoringStyle}
          onDraftType={(draft_type) =>
            setDraft((prev) => ({
              ...prev,
              settings: reconcileDerived(prev.settings, {
                ...prev.settings,
                draft: { ...prev.settings.draft, draft_type },
              }),
            }))
          }
          onScoringStyle={handleScoringStyle}
        />
      )}
      {step === 1 && (
        // M5 L.D2.13: the waiver schedule's presets (Q70) — the pick only;
        // the full schedule is editable in League settings afterwards.
        <div className={mobile ? 'flex flex-col gap-1' : 'space-y-1.5'} data-wizard-waivers>
          {mobile && <span className="text-[13px] font-semibold text-m-t3">Waivers</span>}
          <WaiverScheduleFields s={draft.settings} onSettings={updateSettings} detail={false} idPrefix="create" />
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <ScoringTemplatePicker
            // SC.4: the EFFECTIVE selection — explicit pick, else the
            // active family's own Scout preselection — so what renders
            // selected is exactly what Create will submit.
            value={effectiveScoringId}
            styleFilter={scoringStyle}
            onChange={(scoringSystemId) => setDraft((p) => ({ ...p, scoringSystemId }))}
          />
          <p className={mobile ? 'text-[12px] font-medium text-m-t3' : 'text-[11px] font-medium text-n-6'}>
            You can customize scoring once your league has been created.
          </p>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleAvatarPick}
      />
    </>
  )
  const blockedLine =
    step === STEPS.length - 1 && !canCreate && !submitting
      ? nameMissing
        ? 'Name your league on the Basics step, then pick a scoring template.'
        : 'Pick a scoring template to create your league.'
      : null

  if (mobile) {
    // The phone (gap list §4 item 2): the same steps in a FieldScout Mobile
    // bottom sheet — the New ranking wizard's progress track and footer
    // (lr-myrank §2.2), Back / Continue in place of the desktop stepper.
    // Prevent, don't refuse: the phone has only Back, so Basics holds
    // Continue until the league has a name (the Join sheet's rule) rather
    // than letting it reach a dead Create button; the last step's check
    // stays as a backstop.
    const last = step === STEPS.length - 1
    const stepBlocked = step === 0 && nameMissing ? 'Name your league to continue.' : null
    const footerLine = stepBlocked ?? blockedLine
    return (
      <SettingsSkin layout="mobile">
        {created ? (
          // The success step, composed inline in the same sheet (D119(6)).
          <MobileSheet
            open={open}
            onOpenChange={handleOpenChange}
            title={`${created.name} is live`}
            subtitle={CREATED_LINE}
            showClose
            size="tall"
            footer={<MWizardFooter label="Go to league" onClick={() => handleOpenChange(false)} />}
          >
            <div className="px-5 pb-4">
              <AttachListInline
                leagueId={created.id}
                leagueName={created.name}
                scoringSystemId={created.scoringSystemId}
                attachedListIds={createdAttachedIds}
              />
            </div>
          </MobileSheet>
        ) : (
          <MobileSheet
            open={open}
            onOpenChange={handleOpenChange}
            title="Create a league"
            subtitle={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}
            showClose
            size="tall"
            scrollKey={step}
            footer={
              <MWizardFooter
                onBack={step > 0 && !submitting ? () => setStep(step - 1) : undefined}
                label={!last ? 'Continue' : submitting ? 'Creating…' : 'Create league'}
                onClick={!last ? () => setStep(step + 1) : handleCreate}
                disabled={last ? !canCreate : stepBlocked !== null}
              >
                {footerLine && (
                  <p className="text-center text-[12px] font-medium text-m-t3" role="status">
                    {footerLine}
                  </p>
                )}
              </MWizardFooter>
            }
          >
            <div className="sticky top-0 z-[2] bg-m-b0">
              <MStepProgress step={step} total={STEPS.length} />
            </div>
            <div className="flex flex-col gap-5 px-5 pb-4 pt-4">{stepBody}</div>
          </MobileSheet>
        )}
      </SettingsSkin>
    )
  }

  if (created) {
    // The success step (M2 L.B4.2): §7.4's create-flow offer, composed
    // INLINE (a Dialog inside a Dialog steals focus and closes both — the
    // D119(6) nested-dialog lesson), not a new surface.
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-4 overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              <Icon name="check-circle" size={15} className="mr-1.5 inline align-[-2px] text-positive-strong" />
              {created.name} is live
            </DialogTitle>
            <DialogDescription>{CREATED_LINE}</DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
            <AttachListInline
              leagueId={created.id}
              leagueName={created.name}
              scoringSystemId={created.scoringSystemId}
              attachedListIds={createdAttachedIds}
            />
          </div>

          <div className="flex items-center justify-end border-t border-n-4 pt-3">
            <Button
              type="button"
              variant="blue"
              size="sm"
              onClick={() => handleOpenChange(false)}
            >
              Go to league
              <Icon name="arrow-next" size={13} />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Create a league</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length} — {STEPS[step]}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-1">{stepBody}</div>

        {/* Footer: free-moving stepper + forward action */}
        <div className="flex items-center gap-2.5 border-t border-n-4 pt-3">
          <Stepper step={step} onStep={setStep} />
          <div className="ml-auto">
            {step < STEPS.length - 1 ? (
              <Button type="button" variant="blue" size="sm" onClick={() => setStep(step + 1)}>
                Next
                <Icon name="arrow-next" size={13} />
              </Button>
            ) : (
              <Button
                type="button"
                variant="blue"
                size="sm"
                disabled={!canCreate}
                onClick={handleCreate}
              >
                {submitting ? (
                  <>
                    <Icon name="repeat" size={13} className="animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Icon name="plus" size={13} />
                    Create league
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
        {blockedLine && <p className="text-[11px] font-medium text-n-6">{blockedLine}</p>}
      </DialogContent>
    </Dialog>
  )
}

function ChangeLaterNote() {
  const line = 'These settings can be changed later in League settings.'
  if (useSettingsSkin() === 'mobile') {
    // On the phone, the line under the step's title (the wizard's subtext).
    return <p className="text-[13px] font-medium leading-[1.4] text-m-t3">{line}</p>
  }
  return (
    <p className="flex items-center gap-1.5 rounded-xl bg-surface-sunken px-3.5 py-2.5 text-[11px] font-medium text-n-3">
      <Icon name="info-circle" size={13} className="shrink-0 text-n-6" />
      {line}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Basics: name, avatar, team count
// ---------------------------------------------------------------------------

function BasicsStep({
  draft,
  nameMissing,
  avatarPreview,
  onName,
  onTeamCount,
  onPickAvatar,
  onRemoveAvatar,
}: {
  draft: WizardDraft
  nameMissing: boolean
  avatarPreview: string | null
  onName: (name: string) => void
  onTeamCount: (teamCount: LeagueSettings['team_count']) => void
  onPickAvatar: () => void
  onRemoveAvatar: () => void
}) {
  if (useSettingsSkin() === 'mobile') {
    return (
      <div className="flex flex-col gap-5">
        <MField label="League name" htmlFor="create-league-name">
          <input
            id="create-league-name"
            value={draft.name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Sunday Legends"
            maxLength={100}
            autoComplete="off"
            enterKeyHint="next"
            aria-invalid={nameMissing || undefined}
            required
            className={M_TEXT_FIELD}
          />
        </MField>
        <MField label="League photo (optional)">
          <div className="flex items-center gap-3">
            {avatarPreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview
              <img src={avatarPreview} alt="League photo preview" className="size-14 flex-none rounded-[14px] object-cover" />
            ) : (
              <span className="flex size-14 flex-none items-center justify-center rounded-[14px] bg-m-b2 text-m-t4" aria-hidden>
                <MIcon name="plus" size={18} stroke={1.8} />
              </span>
            )}
            {/* The handoff's "Upload photo" pill (My team page). */}
            <button
              type="button"
              onClick={onPickAvatar}
              className="flex h-8 items-center rounded-pill bg-m-gb px-3.5 text-[13px] font-semibold text-m-tb"
            >
              {avatarPreview ? 'Change photo' : 'Upload photo'}
            </button>
            {avatarPreview && (
              <button type="button" onClick={onRemoveAvatar} className="flex h-8 items-center px-2 text-[13px] font-semibold text-m-t3">
                Remove
              </button>
            )}
          </div>
        </MField>
        <MField label="Number of teams">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Number of teams">
            {TEAM_COUNTS.map((n) => (
              <MChoiceChip key={n} label={String(n)} on={draft.settings.team_count === n} onPick={() => onTeamCount(n)} />
            ))}
          </div>
        </MField>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3.5">
      <div className="space-y-1.5">
        <Label htmlFor="create-league-name" className="text-[12px] font-semibold text-ink">
          League name
        </Label>
        <Input
          id="create-league-name"
          value={draft.name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Sunday Legends"
          maxLength={100}
          aria-invalid={nameMissing || undefined}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[12px] font-semibold text-ink">League avatar (optional)</Label>
        <div className="flex items-center gap-3">
          {avatarPreview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview
            <img
              src={avatarPreview}
              alt="League avatar preview"
              className="h-14 w-14 shrink-0 rounded-[14px] border border-n-4 object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-surface-control text-n-6">
              <Icon name="cup" size={18} />
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="stroke" size="sm" onClick={onPickAvatar}>
              <Icon name="plus" size={13} />
              {avatarPreview ? 'Change image' : 'Add image'}
            </Button>
            {avatarPreview && (
              <Button type="button" variant="ghost" size="sm" onClick={onRemoveAvatar}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="create-league-teams" className="text-[12px] font-semibold text-ink">
          Number of teams
        </Label>
        <ChoiceSelect
          id="create-league-teams"
          ariaLabel="Number of teams"
          value={String(draft.settings.team_count)}
          options={numOptions(TEAM_COUNTS)}
          onValueChange={(v) => onTeamCount(Number(v) as LeagueSettings['team_count'])}
          width="w-28"
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Draft type + scoring style
// ---------------------------------------------------------------------------

function StyleStep({
  draftType,
  scoringStyle,
  onDraftType,
  onScoringStyle,
}: {
  draftType: LeagueSettings['draft']['draft_type']
  scoringStyle: 'ppr' | 'no_ppr'
  onDraftType: (t: LeagueSettings['draft']['draft_type']) => void
  onScoringStyle: (s: 'ppr' | 'no_ppr') => void
}) {
  const draftCards = (
    <>
      <OptionCard
        label="Snake"
        hint="The order reverses every round."
        selected={draftType === 'snake'}
        onSelect={() => onDraftType('snake')}
      />
      <OptionCard
        label="Auction"
        hint="Every manager bids from a budget."
        selected={draftType === 'auction'}
        onSelect={() => onDraftType('auction')}
      />
    </>
  )
  const scoringCards = (
    <>
      <OptionCard
        label="PPR"
        hint="Points per reception (full or half)."
        selected={scoringStyle === 'ppr'}
        onSelect={() => onScoringStyle('ppr')}
      />
      <OptionCard
        label="No PPR"
        hint="Standard — receptions score nothing."
        selected={scoringStyle === 'no_ppr'}
        onSelect={() => onScoringStyle('no_ppr')}
      />
    </>
  )
  const narrows = 'This narrows the templates on the next step.'
  if (useSettingsSkin() === 'mobile') {
    // The phone stacks the same cards as the handoff's radio cards.
    return (
      <div className="flex flex-col gap-5">
        <MField label="Draft type">
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Draft type">
            {draftCards}
          </div>
        </MField>
        <MField label="Scoring type" hint={narrows}>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Scoring type">
            {scoringCards}
          </div>
        </MField>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3.5">
      <div className="space-y-1.5">
        <Label className="text-[12px] font-semibold text-ink">Draft type</Label>
        <div className="grid grid-cols-2 gap-2.5">{draftCards}</div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[12px] font-semibold text-ink">Scoring type</Label>
        <div className="grid grid-cols-2 gap-2.5">{scoringCards}</div>
        <p className="text-[11px] font-medium text-n-6">{narrows}</p>
      </div>
    </div>
  )
}

function OptionCard({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string
  hint: string
  selected: boolean
  onSelect: () => void
}) {
  if (useSettingsSkin() === 'mobile') return <MRadioCard label={label} sub={hint} on={selected} onPick={onSelect} />
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-xl px-3.5 py-3 text-left transition-[background-color,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        // Selected is a resting FILL + the v7 1px blue inset ring, never a lift.
        selected ? 'bg-accent-soft shadow-ring-accent' : 'bg-white shadow-ring-chip hover:bg-surface-sunken',
      )}
    >
      <span className={cn('flex w-full items-center justify-between text-[13px] font-bold tracking-[-0.01em]', selected ? 'text-accent-deep' : 'text-ink')}>
        {label}
        {selected && <Icon name="check-circle" size={14} className="text-accent" />}
      </span>
      <span className="text-[11px] font-medium text-n-3">{hint}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Footer stepper — free movement between the three sections
// ---------------------------------------------------------------------------

function Stepper({ step, onStep }: { step: number; onStep: (i: number) => void }) {
  return (
    <nav aria-label="Create-league steps">
      <ol className="flex items-center gap-1.5">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              aria-current={i === step ? 'step' : undefined}
              onClick={() => onStep(i)}
              className={cn(
                'flex h-btn-sm items-center gap-1.5 rounded-pill px-[9px] text-[10px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                i === step
                  ? 'bg-ink text-white'
                  : 'bg-surface-control text-n-3 hover:bg-surface-pressed hover:text-ink',
              )}
            >
              <span className="fs-num">{i + 1}</span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
