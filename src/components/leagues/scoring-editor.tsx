'use client'

import { useId, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/hooks/use-toast'
import { useLeague, useUpdateLeagueScoring } from '@/hooks/use-league'
import { useLeagueScoringFamily } from '@/hooks/use-draft-pool'
import { useScoringTemplates } from '@/hooks/use-scoring-templates'
import {
  isFormat1Doc,
  type ScoringPosition,
  type ScoringRulesDoc,
  type ScoringRulesDocV2,
} from '@/lib/leagues/scoring/rules-doc'
import { scoringRulesDocSchema } from '@/lib/leagues/scoring/validate-rules-doc'
import { cn } from '@/lib/utils'

import {
  allPositionsOn,
  applyAllPositionsOn,
  applyEdit,
  applyTierEdit,
  canonicalDocEqual,
  canonicalDocJson,
  COEFFICIENT_INPUT_MAX,
  COEFFICIENT_INPUT_STEP,
  dstTierTables,
  format1View,
  isCustomScoringReference,
  isEditableScoringDoc,
  parseCoefficientInput,
  positionLabel,
  SAMPLE_PLAYERS,
  sampleLineTotal,
  saveScoringDoc,
  scoringEditorAccess,
  sectionFieldStates,
  sectionsForPosition,
  STEPPER_POSITIONS,
  type ScoringDocView,
  type ScoringEditorAccess,
  type ScoringEditorSectionId,
  type ScoringFieldState,
  type SaveRefusal,
} from './scoring-editor-ops'
import { InlineIssue } from './settings-form-controls'

/**
 * Custom scoring editor — the shell (SE.7; spec §7.3.3.1 product shape,
 * §16.2's `scoring-editor.tsx` row, §16.5.4 states; D167/D173).
 *
 * The position stepper QB → RB → WR → TE → K → D/ST (§7.3.3.1's literal
 * order), per-section value grids rendered FROM the ops catalog (never a
 * hand-written form row — D173), the All-Positions switch as DERIVED state,
 * and save through SE.6's `useUpdateLeagueScoring` with the working document
 * normalized at the door (`saveScoringDoc` → `buildSavePayload`; the RPC
 * refuses un-normalized docs rather than rewriting them).
 *
 * SE.8 fills SE.7's two reserved slots: every position page carries its
 * fixed §7.3.3.1 sample line with the live total under the doc-as-edited
 * (`sampleLineTotal` — the REAL pipeline, D171; the client computes SAMPLE
 * totals for display and still never computes real scores), and the D/ST
 * page carries the PA/YA tier tables — labels from the doc's OWN
 * tier cut list, boundaries read-only, payouts editable (F178; F59 owns
 * boundary editing).
 *
 * Reads ride the two ALREADY-INVALIDATED query keys and nothing else
 * (D275(1)'s one-reader rule): the league detail (`useLeague`) for role,
 * status and the scoring reference, and `useLeagueScoringFamily` for the
 * document itself — both are in `leagueScoringInvalidationKeys`, so this
 * editor's own save refreshes this editor's own read. That is the full
 * extent of the freshness claim: a DIFFERENT client's open surface is
 * bounded by no timer at all (ledger F167 — do not claim more here).
 *
 * Access: commissioner-only editing, league in `setup`/`scheduled` — the
 * RPC enforces, the UI states it (read-only grid + notice otherwise). The
 * member read-only VIEW surface proper is SE.9's; what renders here for a
 * member is the stated-restriction fallback, not that deliverable.
 *
 * Q28 is OPEN and deliberately not improvised around: no shape guardrail
 * anywhere in this surface. The natural flow edits values on a loaded fork
 * (it cannot produce `{}`), and a structurally empty document that arrives
 * anyway renders honestly as "not scored" fields.
 */
export function ScoringEditor({ leagueId, className }: { leagueId: string; className?: string }) {
  const leagueQuery = useLeague(leagueId)
  const templatesQuery = useScoringTemplates()
  const scoringQuery = useLeagueScoringFamily(leagueId)

  // §16.5.4 state 1 — skeleton while anything this surface needs is loading.
  if (leagueQuery.isPending || templatesQuery.isPending || scoringQuery.isPending) {
    return <ScoringEditorSkeleton className={className} />
  }

  const retryAll = () => {
    void leagueQuery.refetch()
    void templatesQuery.refetch()
    void scoringQuery.refetch()
  }

  // §16.5.4 state 3 — error-with-retry. The scoring read only lands here
  // when it has NO last-good copy; with one, it degrades below instead.
  if (
    leagueQuery.isError ||
    !leagueQuery.data ||
    templatesQuery.isError ||
    !templatesQuery.data ||
    (scoringQuery.isError && scoringQuery.data === undefined)
  ) {
    return <ScoringEditorLoadError className={className} onRetry={retryAll} />
  }

  const detail = leagueQuery.data
  const access = scoringEditorAccess(detail.my_role, detail.league.status)
  const templateIds = templatesQuery.data.map((t) => t.id)

  // Not customized: the league references a seeded template (D169 closed the
  // world — template XOR own fork). §16.5.4 state 2, the designed empty copy,
  // for the commissioner; members have nothing to view yet (SE.9 owns the
  // member surface), so they get nothing rather than a teaser.
  if (!isCustomScoringReference(detail.league.scoring_system_id, templateIds)) {
    if (!access.isCommissioner) return null
    const templateName = templatesQuery.data.find(
      (t) => t.id === detail.league.scoring_system_id,
    )?.name
    return <ScoringEditorEmpty className={className} templateName={templateName} />
  }

  // The stored document. The write walls make an invalid league doc
  // unrepresentable (SE.4b), but that is the database's guarantee, not this
  // client's — so the load still parses and refuses LOUDLY on failure
  // rather than rendering plausible nonsense (CLAUDE.md's "nothing
  // happened" rule).
  const parsed = scoringRulesDocSchema.safeParse(scoringQuery.data)
  if (scoringQuery.data == null || !parsed.success) {
    return <ScoringEditorLoadError className={className} onRetry={retryAll} />
  }
  const doc = parsed.data

  // §16.5.4 state 4 — degraded: a refetch failed but a last-good copy is in
  // hand. Banner + last-good data, read-only — never wrong numbers, and
  // never an edit over a document we could not confirm is current.
  const staleDegraded = scoringQuery.isError

  if (isFormat1Doc(doc)) {
    // A fork always writes format 2 (SE.5); a flat doc on a custom row is
    // only reachable by a hand-authored API save. Show it read-only rather
    // than guessing tier cuts to upgrade it (Q28 stays unimprovised).
    return (
      <ScoringEditorBody
        className={className}
        leagueId={leagueId}
        mode={{ kind: 'readonly', view: format1View(doc), doc }}
        notices={[
          ...(staleDegraded ? [STALE_NOTICE] : []),
          {
            tone: 'warning' as const,
            message:
              "This league's custom scoring uses the flat one-value format, which the per-position editor can't edit. Values are shown read-only.",
          },
          ...accessNotices(access),
        ]}
      />
    )
  }

  if (!isEditableScoringDoc(doc)) {
    // Unreachable after the format-1 branch, kept as a loud type fence.
    return <ScoringEditorLoadError className={className} onRetry={retryAll} />
  }

  const editable = access.canEdit && !staleDegraded
  return (
    <ScoringEditorBody
      // Remount on a fresh baseline (the settings-panel round-trip reset):
      // a successful save invalidates → refetches → new canonical json →
      // the working copy re-seeds from the persisted state.
      //
      // F191: the key derives from the DOCUMENT CONTENT ONLY. Status and
      // editability changes reconcile through props WITHOUT a remount — a
      // failed refetch that flips `editable` with no data change must not
      // discard the commissioner's typed-but-unsaved values (the body keeps
      // them and states so). The one thing that still resets the form is a
      // genuinely different persisted document.
      key={canonicalDocJson(doc)}
      className={className}
      leagueId={leagueId}
      mode={editable ? { kind: 'edit', doc } : { kind: 'readonly', view: doc, doc }}
      notices={[...(staleDegraded ? [STALE_NOTICE] : []), ...accessNotices(access)]}
    />
  )
}

// ---------------------------------------------------------------------------
// Notices (§16.5.4's designed-copy rule: the UI states the restriction)
// ---------------------------------------------------------------------------

interface EditorNotice {
  tone: 'warning' | 'error'
  message: string
}

const STALE_NOTICE: EditorNotice = {
  tone: 'warning',
  message:
    "Scoring values couldn't refresh — showing the last loaded copy read-only. Retry when you're back online.",
}

function accessNotices(access: ScoringEditorAccess): EditorNotice[] {
  const notices: EditorNotice[] = []
  if (!access.isCommissioner) {
    notices.push({
      tone: 'warning',
      message:
        "You're viewing this league's custom scoring — only the commissioner can change it.",
    })
  }
  if (!access.inEditWindow) {
    notices.push({
      tone: 'warning',
      message:
        'Scoring locks when the draft starts — the season scores from the copy frozen at that moment (§7.3.3).',
    })
  }
  return notices
}

// ---------------------------------------------------------------------------
// The four §16.5.4 states' standalone pieces
// ---------------------------------------------------------------------------

function ScoringEditorSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className} aria-busy="true" aria-label="Loading custom scoring">
      <CardContent className="flex flex-col gap-3 p-4">
        <Skeleton className="h-6 w-44 rounded-sm" />
        <div className="flex gap-1.5">
          {STEPPER_POSITIONS.map((p) => (
            <Skeleton key={p} className="h-btn-md w-14 rounded-sm" />
          ))}
        </div>
        <Skeleton className="h-28 w-full rounded-sm" />
        <Skeleton className="h-28 w-full rounded-sm" />
      </CardContent>
    </Card>
  )
}

function ScoringEditorLoadError({
  className,
  onRetry,
}: {
  className?: string
  onRetry: () => void
}) {
  return (
    <Card className={cn('border-negative bg-negative-soft', className)}>
      <CardContent className="flex flex-col items-start gap-2 p-4">
        <p className="text-[13px] font-bold" role="alert">
          Couldn&apos;t load this league&apos;s custom scoring.
        </p>
        <p className="text-[12px] font-semibold text-n-3">
          Check your connection and try again — nothing was changed.
        </p>
        <Button type="button" variant="stroke" size="sm" onClick={onRetry}>
          <Icon name="reset" size={13} /> Retry
        </Button>
      </CardContent>
    </Card>
  )
}

/** §16.5.4 state 2 — designed empty copy, never blank. No fork affordance is
 *  promised here: the "Customize" entry is SE.9's, and this copy is updated
 *  to point at it when it lands (ledger hand-off on SE.7's PR). */
function ScoringEditorEmpty({
  className,
  templateName,
}: {
  className?: string
  templateName: string | undefined
}) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-1.5 p-4">
        <CardTitle>Custom scoring</CardTitle>
        <p className="text-[12px] font-semibold text-n-3">
          {templateName
            ? `This league scores with the ${templateName} template — one shared rulebook, unedited.`
            : 'This league scores with a shared template — one rulebook, unedited.'}{' '}
          Once the league has its own custom copy of a template, every value is
          edited right here, position by position.
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The editor body — stepper, sections, grids, save
// ---------------------------------------------------------------------------

type EditorMode =
  | { kind: 'edit'; doc: ScoringRulesDocV2 }
  | { kind: 'readonly'; view: ScoringDocView; doc: ScoringRulesDoc }

function ScoringEditorBody({
  className,
  leagueId,
  mode,
  notices,
}: {
  className?: string
  leagueId: string
  mode: EditorMode
  notices: EditorNotice[]
}) {
  // F191: the working copy SURVIVES mode changes. The parent's remount key is
  // content-only, so a status/editable flip (a failed refetch, the draft
  // starting) reaches this body as a PROP change — the state below, and the
  // commissioner's unsaved typing with it, stays put. Seeding is lazy
  // (`working` falls back to the persisted doc) because the body can now
  // mount in readonly mode and become editable later without remounting.
  const [workingState, setWorkingState] = useState<ScoringRulesDocV2 | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  // The switch is DERIVED from the document (§7.3.3.1); this records only the
  // commissioner's in-session intent to edit per position BEFORE any override
  // exists (a state the document cannot represent, by design — on reload a
  // no-override section reads ON again, exactly as the spec rules).
  const [customizing, setCustomizing] = useState<Partial<Record<ScoringEditorSectionId, boolean>>>({})
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null)
  const [adjustedNote, setAdjustedNote] = useState<string | null>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const idBase = useId()

  const { mutateAsync, isPending: isSaving } = useUpdateLeagueScoring(leagueId)

  const working = workingState ?? (mode.kind === 'edit' ? mode.doc : null)
  const editable = mode.kind === 'edit' && working !== null
  const view: ScoringDocView = mode.kind === 'edit' ? (working ?? mode.doc) : mode.view
  const dirty = mode.kind === 'edit' && working !== null && !canonicalDocEqual(working, mode.doc)
  // While read-only (degraded refetch, draft started), the page shows the
  // PERSISTED document — never unconfirmed edits as if they were the
  // league's scoring — but the unsaved copy is retained and said (F191).
  const retainedUnsaved =
    mode.kind === 'readonly' &&
    workingState !== null &&
    !canonicalDocEqual(workingState, mode.doc)
  // What the sample line and tier tables score: the doc-as-edited when
  // editing, the persisted doc otherwise (matching the grid's values).
  const activeDoc: ScoringRulesDoc = mode.kind === 'edit' ? (working ?? mode.doc) : mode.doc

  const position = STEPPER_POSITIONS[stepIndex] ?? 'QB'
  const sections = sectionsForPosition(position)
  const panelId = `${idBase}-scoring-tabpanel`

  async function handleSave() {
    if (mode.kind !== 'edit' || working === null || !dirty || isSaving) return
    setRefusal(null)
    // One save door: normalize-at-the-door + refusal classification live in
    // the ops layer (`saveScoringDoc`). On refusal the working copy is KEPT
    // and the refusal rendered beside it — never a silent revert: the only
    // thing that resets this form is a successful save's own invalidation
    // remounting it on the fresh baseline.
    const outcome = await saveScoringDoc({ working, mutateAsync })
    if (outcome.ok) {
      toast({
        title: 'Scoring saved',
        description: 'Your league now scores with these values.',
      })
    } else {
      setRefusal(outcome.refusal)
    }
  }

  function noteAdjustment(label: string, adjusted: 'clamped' | 'rounded' | null) {
    setAdjustedNote(
      adjusted === 'clamped'
        ? `Values are capped at ±${COEFFICIENT_INPUT_MAX} — ${label} was adjusted to fit.`
        : adjusted === 'rounded'
          ? `Values use ${COEFFICIENT_INPUT_STEP} steps — ${label} was rounded.`
          : null,
    )
  }

  function commitEdit(
    sectionId: ScoringEditorSectionId,
    key: string,
    label: string,
    scope: 'all' | ScoringPosition,
    value: number | null,
    adjusted: 'clamped' | 'rounded' | null,
  ) {
    if (mode.kind !== 'edit' || working === null) return
    setWorkingState(applyEdit(working, { section: sectionId, key, scope, value }))
    noteAdjustment(label, adjusted)
  }

  /** The D/ST tier tables' commit — through the ops layer's
   *  `applyTierEdit`, the grid's one-write-path sibling (F178). */
  function commitTierEdit(
    key: string,
    label: string,
    value: number,
    adjusted: 'clamped' | 'rounded' | null,
  ) {
    if (mode.kind !== 'edit' || working === null) return
    setWorkingState(applyTierEdit(working, key, value))
    noteAdjustment(label, adjusted)
  }

  function toggleAllPositions(sectionId: ScoringEditorSectionId, next: boolean) {
    if (mode.kind !== 'edit' || working === null) return
    if (!next) {
      setCustomizing((prev) => ({ ...prev, [sectionId]: true }))
      return
    }
    setCustomizing((prev) => ({ ...prev, [sectionId]: false }))
    if (!allPositionsOn(working, sectionId)) {
      setWorkingState(applyAllPositionsOn(working, sectionId, position))
    }
  }

  /** R682: the stepper is a real tablist — roving tabindex, arrow-key
   *  selection (wrapping), Home/End. Activation follows focus (the WAI-ARIA
   *  automatic-activation pattern). */
  function handleStepperKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = STEPPER_POSITIONS.length - 1
    let next: number | null = null
    if (event.key === 'ArrowRight') next = stepIndex === last ? 0 : stepIndex + 1
    else if (event.key === 'ArrowLeft') next = stepIndex === 0 ? last : stepIndex - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    setStepIndex(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-3.5 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <CardTitle>Custom scoring</CardTitle>
          {mode.kind === 'edit' && (
            <>
              <span className="text-[12px] font-bold text-n-3">
                {dirty ? 'You have unsaved scoring changes.' : 'All changes saved.'}
              </span>
              <Button
                type="button"
                variant="blue"
                size="sm"
                shadow
                className="ml-auto"
                disabled={!dirty || isSaving}
                onClick={handleSave}
              >
                {isSaving ? (
                  <>
                    <Icon name="repeat" size={13} className="animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <Icon name="save" size={13} /> Save scoring
                  </>
                )}
              </Button>
            </>
          )}
        </div>

        {notices.map((notice) => (
          <InlineIssue key={notice.message} tone={notice.tone} message={notice.message} />
        ))}

        {retainedUnsaved && (
          <InlineIssue
            tone="warning"
            message="You have unsaved scoring edits from this session — they're kept on this page but haven't been saved."
          />
        )}

        {refusal && <SaveRefusalNotice refusal={refusal} />}

        {/* The stepper — §7.3.3.1's literal order, one page per position.
            R682: roving tabindex + arrow-key selection; every tab controls
            the one position panel below. */}
        <div
          role="tablist"
          aria-label="Scoring position"
          className="flex gap-1.5 overflow-x-auto pb-0.5"
          onKeyDown={handleStepperKeyDown}
        >
          {STEPPER_POSITIONS.map((p, index) => (
            <Button
              key={p}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              type="button"
              role="tab"
              id={`${idBase}-scoring-tab-${p}`}
              aria-selected={index === stepIndex}
              aria-controls={panelId}
              tabIndex={index === stepIndex ? 0 : -1}
              variant={index === stepIndex ? 'dark' : 'stroke'}
              size="md"
              className="shrink-0"
              onClick={() => setStepIndex(index)}
            >
              {positionLabel(p)}
            </Button>
          ))}
        </div>

        {adjustedNote && (
          <p role="status" className="text-[11px] font-semibold text-n-3">
            {adjustedNote}
          </p>
        )}

        <div
          role="tabpanel"
          id={panelId}
          aria-labelledby={`${idBase}-scoring-tab-${position}`}
          className="flex flex-col gap-3"
        >
          {sections.map((section) => {
            const derivedOn = allPositionsOn(view, section.id)
            const switchOn = derivedOn && customizing[section.id] !== true
            const fields = sectionFieldStates(view, section.id, position)
            // K and D/ST are single-position pages (Q12): their sections
            // carry no All-Positions switch — guardrail 3 scopes their keys
            // to that one position, so "apply to every position" has nothing
            // legal to mean. Their edits write `base`, exactly where a
            // template fork carries them.
            const multiPosition = section.positions.length > 1
            const scope: 'all' | ScoringPosition = multiPosition && !switchOn ? position : 'all'
            return (
              <section key={section.id} aria-label={`${section.title} scoring`}>
                <div className="flex flex-col gap-2 rounded-sm border border-ink p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[13px] font-extrabold">{section.title}</h3>
                    {multiPosition && (
                      <label className="flex items-center gap-2 text-[11px] font-bold text-n-3">
                        All positions
                        <Switch
                          checked={switchOn}
                          disabled={!editable}
                          onCheckedChange={(next) => toggleAllPositions(section.id, next)}
                          aria-label={`${section.title}: same values for all positions`}
                        />
                      </label>
                    )}
                  </div>
                  {multiPosition && !switchOn && (
                    <p className="text-[11px] font-semibold text-n-3">
                      Setting {positionLabel(position)} values — other positions keep the
                      shared values. Set a value to 0 to switch a category off for{' '}
                      {positionLabel(position)} only.
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {fields.map((field) => (
                      <CoefficientCell
                        key={`${position}-${field.key}`}
                        field={field}
                        disabled={!editable}
                        onCommit={(value, adjusted) =>
                          commitEdit(section.id, field.key, field.label, scope, value, adjusted)
                        }
                      />
                    ))}
                  </div>
                </div>
              </section>
            )
          })}

          {/* The D/ST tier tables — PA + YA payouts over the doc's OWN
              tier cut list, boundaries read-only (SE.8; §7.3.3.1(b), F178). */}
          {position === 'DST' && (
            <DstTierTables doc={activeDoc} disabled={!editable} onCommit={commitTierEdit} />
          )}

          {/* The live sample line — this position's fixed §7.3.3.1 player
              through the REAL pipeline, recomputed keystroke-by-keystroke
              from the doc-as-edited (SE.8; D171, F178). */}
          <SampleLine position={position} doc={activeDoc} />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="stroke"
            size="sm"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          >
            <Icon name="arrow-prev" size={13} /> Back
          </Button>
          <span className="fs-num text-[11px] font-bold text-n-3">
            {stepIndex + 1} / {STEPPER_POSITIONS.length}
          </span>
          <Button
            type="button"
            variant="stroke"
            size="sm"
            disabled={stepIndex === STEPPER_POSITIONS.length - 1}
            onClick={() => setStepIndex((i) => Math.min(STEPPER_POSITIONS.length - 1, i + 1))}
          >
            Next <Icon name="arrow-next" size={13} />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The live sample line (SE.8; §7.3.3.1's sample-players bullet; D171)
// ---------------------------------------------------------------------------

/**
 * One fixed sample player per position, with the live total under the
 * doc-as-edited. The total runs the REAL pipeline (`sampleLineTotal` —
 * resolver + derive + calculator, D171); the boundary stands as stated in
 * the ops layer: the client computes SAMPLE totals for display and still
 * never computes real scores.
 */
function SampleLine({ position, doc }: { position: ScoringPosition; doc: ScoringRulesDoc }) {
  const sample = SAMPLE_PLAYERS[position]
  const total = sampleLineTotal(doc, position)
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-ink p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[12px] font-extrabold">
          Sample week — {sample.name}{' '}
          <span className="font-semibold text-n-3">({positionLabel(position)})</span>
        </p>
        <p aria-live="polite" className="text-[13px] font-extrabold">
          <span className="fs-num">{total.toFixed(2)}</span>{' '}
          <span className="text-[11px] font-bold text-n-3">pts under these values</span>
        </p>
      </div>
      <p className="text-[11px] font-semibold text-n-3">{sample.line}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The D/ST tier tables (SE.8; §7.3.3.1's D/ST bullet (b); F178)
// ---------------------------------------------------------------------------

/**
 * PA and YA are two INDEPENDENT, additively-paying tables — never
 * alternatives. Which tables render is what the doc pays; row labels come
 * from the doc's own tier cut lists (derived in the ops layer, never
 * hand-written here); boundaries are read-only — ONLY what each tier pays
 * is editable. The row the Seahawks sample lands in is marked, so the
 * family straddle (17 PA: ESPN 14–17 vs shared 14–20) stays visible.
 */
function DstTierTables({
  doc,
  disabled,
  onCommit,
}: {
  doc: ScoringRulesDoc
  disabled: boolean
  onCommit: (key: string, label: string, value: number, adjusted: 'clamped' | 'rounded' | null) => void
}) {
  const tables = dstTierTables(doc)
  if (tables.length === 0) return null
  return (
    <>
      {tables.map((table) => (
        <section key={table.family} aria-label={`${table.title} tier scoring`}>
          <div className="flex flex-col gap-2 rounded-sm border border-ink p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h3 className="text-[13px] font-extrabold">{table.title}</h3>
              <p className="text-[11px] font-semibold text-n-3">
                Ranges come with the league&apos;s scoring — only the points are editable.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {table.rows.map((row) => (
                <CoefficientCell
                  key={row.key}
                  field={{
                    key: row.key,
                    label: row.label,
                    value: row.payout,
                    baseValue: row.basePayout,
                    overridden: row.overridden,
                  }}
                  disabled={disabled}
                  // §7.3.3.1(b): un-paying a tier outright is table
                  // structure (F59) — "pays nothing" is an explicit 0.
                  allowClear={false}
                  highlight={row.sampleHot}
                  hint={
                    row.sampleHot
                      ? `${SAMPLE_PLAYERS.DST.name} this week: ${table.sampleValue}`
                      : undefined
                  }
                  onCommit={(value, adjusted) => {
                    if (value !== null) onCommit(row.key, row.label, value, adjusted)
                  }}
                />
              ))}
            </div>
          </div>
        </section>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Save refusal rendering — which LAYER refused decides the treatment
// ---------------------------------------------------------------------------

/**
 * The SE.6 rung, applied to rendering: a Zod/guardrail 400 lists its
 * per-field messages, an RPC 403/404/409 shows the server's own refusal
 * sentence, a 5xx and a network failure each say what is and is not known.
 * The working copy stays on screen in every branch — the refusal renders
 * BESIDE the edits, never in place of them.
 */
function SaveRefusalNotice({ refusal }: { refusal: SaveRefusal }) {
  if (refusal.kind === 'validation') {
    const entries = Object.entries(refusal.fieldErrors)
    return (
      <div
        role="alert"
        className="flex flex-col gap-1 rounded-sm border border-negative bg-negative-soft px-3 py-2"
      >
        <p className="text-[12px] font-bold">
          The server refused these values — nothing was changed.
        </p>
        {entries.length === 0 ? (
          <p className="text-[11px] font-semibold text-n-3">{refusal.message}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {entries.map(([path, messages]) => (
              <li key={path} className="text-[11px] font-semibold text-n-3">
                <span className="fs-num font-bold text-ink">{path}</span>: {messages.join(' · ')}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  if (refusal.kind === 'refused') {
    return <InlineIssue tone="error" message={`${refusal.message} Nothing was changed.`} />
  }
  if (refusal.kind === 'failed') {
    return (
      <InlineIssue
        tone="error"
        message={`Saving failed on the server (HTTP ${refusal.status}). Your edits are still here — try again.`}
      />
    )
  }
  return (
    <InlineIssue
      tone="error"
      message="Couldn't reach FieldScout — the save may not have gone through. Your edits are still here; check your connection and try again."
    />
  )
}

// ---------------------------------------------------------------------------
// One value cell
// ---------------------------------------------------------------------------

/**
 * A single coefficient input. Commits live while the typed text parses to an
 * unadjusted value (so SE.8's sample line will recompute keystroke-by-
 * keystroke); values needing the guardrail-5 clamp/round commit on blur,
 * with the adjustment SAID (clamp-with-error, never a silent rewrite). An
 * emptied field commits `null` on blur: under All positions that un-scores
 * the category; per position it reverts to the shared value.
 */
function CoefficientCell({
  field,
  disabled,
  onCommit,
  allowClear = true,
  highlight = false,
  hint,
}: {
  field: ScoringFieldState
  disabled: boolean
  onCommit: (value: number | null, adjusted: 'clamped' | 'rounded' | null) => void
  /** SE.8: tier rows refuse the clear→remove arm (an emptied field falls
   *  back to the last good value) — removal is table structure, F59's. */
  allowClear?: boolean
  /** Resting STATE carried by fill + border (the elevation ruling — never a
   *  shadow): the tier row the sample week lands in. */
  highlight?: boolean
  /** Small note under the label (the sample's raw value on a hot row). */
  hint?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (field.value === undefined ? '' : String(field.value))

  function handleChange(raw: string) {
    setDraft(raw)
    const parsed = parseCoefficientInput(raw)
    if (parsed.kind === 'value' && parsed.adjusted === null) {
      onCommit(parsed.value, null)
    }
  }

  function handleBlur() {
    if (draft === null) return
    const parsed = parseCoefficientInput(draft)
    if (parsed.kind === 'value') onCommit(parsed.value, parsed.adjusted)
    else if (parsed.kind === 'cleared' && allowClear) onCommit(null, null)
    // 'invalid' (or a refused clear): nothing commits — the cell falls back
    // to the last good value.
    setDraft(null)
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-sm border px-2.5 py-1.5',
        highlight ? 'border-ink bg-accent-soft' : 'border-n-4',
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={`scoring-${field.key}`}
          className="block truncate text-[12px] font-bold"
          title={field.label}
        >
          {field.label}
        </label>
        {hint ? (
          <p className="text-[10px] font-semibold text-n-3">{hint}</p>
        ) : null}
        {field.overridden ? (
          <p className="text-[10px] font-semibold text-n-3">
            All positions:{' '}
            <span className="fs-num">
              {field.baseValue === undefined ? 'not scored' : field.baseValue}
            </span>
          </p>
        ) : field.value === undefined ? (
          <p className="text-[10px] font-semibold text-n-3">Not scored</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {field.overridden && (
          <Badge variant="stroke-purple" className="text-[10px]">
            custom
          </Badge>
        )}
        <Input
          id={`scoring-${field.key}`}
          type="number"
          inputMode="decimal"
          step={COEFFICIENT_INPUT_STEP}
          min={-COEFFICIENT_INPUT_MAX}
          max={COEFFICIENT_INPUT_MAX}
          value={shown}
          placeholder="—"
          disabled={disabled}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          className="h-btn-md w-24 fs-num text-right text-[12px] font-bold"
        />
      </div>
    </div>
  )
}
