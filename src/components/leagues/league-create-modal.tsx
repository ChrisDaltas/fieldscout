'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'

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
import { toast } from '@/hooks/use-toast'
import { useLeagueLists } from '@/hooks/use-league-lists'
import { useCreateLeague } from '@/hooks/use-leagues'
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { cn } from '@/lib/utils'

import { AttachListInline } from './attach-list-modal'
import {
  initialWizardDraft,
  reconcileDerived,
  toCreateInput,
  type WizardDraft,
} from './league-create-wizard-ops'
import { ChoiceSelect, numOptions } from './settings-form-controls'
import { ScoringTemplatePicker } from './scoring-template-picker'

/**
 * Create-league modal — the 3-step replacement for the /leagues/new page
 * wizard (Chris, 2026-08-03). Same data spine as before (no fork): the
 * `WizardDraft` + `toCreateInput` ops module and the `useCreateLeague`
 * hook → create_league RPC. Everything not asked here keeps its §7.3
 * default and is editable afterwards in the settings panel — which is why
 * every step leads with the "you can change this later" line.
 *
 *   1. Basics    — name, optional avatar, team count
 *   2. Style     — draft type (snake/auction) + scoring style (PPR/no-PPR)
 *   3. Template  — pick a scoring template (filtered by the style pick)
 *
 * The bottom stepper moves freely between steps (no gating between
 * sections; only Create validates). The avatar can't upload before the
 * league exists (the storage path is keyed by league id), so the file is
 * held locally and posted to /api/leagues/[id]/profile right after create.
 */

const STEPS = ['Basics', 'Draft & scoring', 'Scoring template'] as const

export function LeagueCreateModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<WizardDraft>(initialWizardDraft)
  const [step, setStep] = useState(0)
  const [scoringStyle, setScoringStyle] = useState<'ppr' | 'no_ppr'>('ppr')
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
      setScoringStyle('ppr')
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
    // template may no longer be offered, so the pick resets with it.
    setDraft((p) => ({ ...p, scoringSystemId: null }))
  }

  const nameMissing = draft.name.trim().length === 0
  const input = toCreateInput(draft)
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
        scoringSystemId: draft.scoringSystemId,
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

  if (created) {
    // The success step (M2 L.B4.2): §7.4's create-flow offer, composed
    // INLINE (a Dialog inside a Dialog steals focus and closes both — the
    // D119(6) nested-dialog lesson), not a new surface.
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-4 overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              <Icon name="check-circle" size={15} className="mr-1.5 inline align-[-2px]" />
              {created.name} is live
            </DialogTitle>
            <DialogDescription>
              Invite your managers from the league home. Want your rankings
              along? Attach a list now — it&rsquo;s one tap away in the draft
              room and can feed your autopick.
            </DialogDescription>
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
              shadow
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

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-1">
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

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <ScoringTemplatePicker
                value={draft.scoringSystemId}
                styleFilter={scoringStyle}
                onChange={(scoringSystemId) => setDraft((p) => ({ ...p, scoringSystemId }))}
              />
              <p className="text-[12px] font-semibold text-n-3">
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
        </div>

        {/* Footer: free-moving stepper + forward action */}
        <div className="flex items-center gap-2.5 border-t border-n-4 pt-3">
          <Stepper step={step} onStep={setStep} />
          <div className="ml-auto">
            {step < STEPS.length - 1 ? (
              <Button type="button" variant="blue" size="sm" shadow onClick={() => setStep(step + 1)}>
                Next
                <Icon name="arrow-next" size={13} />
              </Button>
            ) : (
              <Button
                type="button"
                variant="blue"
                size="sm"
                shadow
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
        {step === STEPS.length - 1 && !canCreate && !submitting && (
          <p className="text-[11px] font-semibold text-n-3">
            {nameMissing
              ? 'Name your league on the Basics step, then pick a scoring template.'
              : 'Pick a scoring template to create your league.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ChangeLaterNote() {
  return (
    <p className="flex items-center gap-1.5 rounded-sm border border-n-4 bg-page px-3 py-2 text-[12px] font-semibold text-n-3">
      <Icon name="info-circle" size={14} className="shrink-0" />
      These settings can be changed later in League settings.
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
  return (
    <div className="flex flex-col gap-3.5">
      <div className="space-y-1.5">
        <Label htmlFor="create-league-name" className="text-[13px] font-bold">
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
        <Label className="text-[13px] font-bold">League avatar (optional)</Label>
        <div className="flex items-center gap-3">
          {avatarPreview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview
            <img
              src={avatarPreview}
              alt="League avatar preview"
              className="h-14 w-14 shrink-0 rounded-sm border border-ink object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border border-n-4 bg-n-5 text-n-3">
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
        <Label htmlFor="create-league-teams" className="text-[13px] font-bold">
          Number of teams
        </Label>
        <ChoiceSelect
          id="create-league-teams"
          ariaLabel="Number of teams"
          value={String(draft.settings.team_count)}
          options={numOptions([8, 10, 12, 14, 16])}
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
  return (
    <div className="flex flex-col gap-3.5">
      <div className="space-y-1.5">
        <Label className="text-[13px] font-bold">Draft type</Label>
        <div className="grid grid-cols-2 gap-2.5">
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
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[13px] font-bold">Scoring type</Label>
        <div className="grid grid-cols-2 gap-2.5">
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
        </div>
        <p className="text-[11px] font-semibold text-n-3">
          This narrows the templates on the next step.
        </p>
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
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-sm border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-ink bg-accent-soft' : 'border-n-4 bg-page hover:border-ink',
      )}
    >
      <span className="flex w-full items-center justify-between text-[13px] font-extrabold">
        {label}
        {selected && <Icon name="check-circle" size={14} />}
      </span>
      <span className="text-[11px] font-semibold text-n-3">{hint}</span>
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
                'flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[12px] font-bold transition-colors',
                i === step
                  ? 'border-ink bg-ink text-white'
                  : 'border-n-4 bg-page text-n-3 hover:border-ink hover:text-ink',
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
