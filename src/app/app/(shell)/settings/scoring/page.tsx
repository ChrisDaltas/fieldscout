'use client'

import { useRouter } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileScoringSettings } from '@/components/mobile/settings/mobile-scoring-settings'
import { AIInsight } from '@/components/ui/ai-insight'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useScoringEditor } from '@/hooks/use-scoring-editor'
import { SCORING_PRESETS } from '@/lib/scoring/default'
import {
  PRO_SCORING_UPSELL,
  SCORING_GROUPS,
  SYSTEM_NAME_MAX,
  formatPoints,
  systemNameHint,
  systemNameValue,
  type StatFieldMeta,
} from '@/lib/scoring/scoring-editor'
import { cn } from '@/lib/utils'

/* --------------------------------- Page --------------------------------- */

/**
 * Scoring builder. The phone draws its own screen on the same editor
 * (`MobileScoringSettings`, gap list §4 item 101); desktop is unchanged.
 */
export default function ScoringSettingsPage() {
  return <ByLayout desktop={<DesktopScoringSettings />} mobile={<MobileScoringSettings />} />
}

/**
 * Desktop scoring builder — outside-the-nav settings page (quiet Back button,
 * no active nav item), in the v7 Account settings language: 14px bold
 * section titles over hairline-bordered row groups. Two columns: Basic
 * settings on the left, Scout AI read + per-phase scoring groups on the
 * right. The editor itself (presets, custom system, save) is
 * `useScoringEditor`.
 */
function DesktopScoringSettings() {
  const router = useRouter()
  const {
    canCustomize,
    isPageLoading,
    mode,
    name,
    setName,
    rules,
    changeMode: handleModeChange,
    changeRule: applyRuleChange,
    reset: handleReset,
    save: saveMutation,
    insight,
    isFullPpr,
    showCustomOption,
    customLabel,
  } = useScoringEditor()

  return (
    <div className="max-w-[880px]">
      <PageHeader title="Scoring" />

      <div className="mb-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      </div>

      {isPageLoading ? (
        <ScoringSkeleton />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.3fr]">
          {/* Left: basics + Pro moment */}
          <div className="flex flex-col gap-6">
            <ScoringSection title="Basic settings">
              <div className="flex flex-col gap-3 px-3.5 py-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="scoring-name" className={FIELD_LABEL}>
                    System name
                  </Label>
                  <Input
                    id="scoring-name"
                    value={systemNameValue(mode, name)}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={SYSTEM_NAME_MAX}
                    disabled={!canCustomize || mode !== 'custom'}
                  />
                  <p className="text-[10px] font-medium text-n-6">
                    {systemNameHint(mode)}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="scoring-type" className={FIELD_LABEL}>
                    Scoring type
                  </Label>
                  <Select value={mode} onValueChange={handleModeChange}>
                    <SelectTrigger id="scoring-type">
                      <SelectValue placeholder="Pick a scoring system" />
                    </SelectTrigger>
                    <SelectContent>
                      {SCORING_PRESETS.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </SelectItem>
                      ))}
                      {showCustomOption && (
                        <>
                          <SelectSeparator />
                          <SelectItem value="custom">
                            {customLabel}
                          </SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex min-h-[44px] items-center gap-3.5 border-t border-n-4 px-3.5 py-[7px]">
                <div className="mr-auto flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-ink">
                    Full PPR
                  </span>
                  <span className="text-[10px] font-medium text-n-6">
                    1 point per reception
                  </span>
                </div>
                <Switch
                  checked={isFullPpr}
                  onCheckedChange={(checked) =>
                    applyRuleChange('receptions', checked ? 1 : 0)
                  }
                  disabled={!canCustomize}
                  aria-label="Full PPR"
                />
              </div>
            </ScoringSection>

            {!canCustomize && (
              <AIInsight heading={PRO_SCORING_UPSELL.heading}>
                <p>{PRO_SCORING_UPSELL.body}</p>
                <div className="mt-3">
                  <Button
                    variant="blue"
                    size="sm"
                    onClick={() => router.push('/app/settings/billing')}
                  >
                    <Icon name="star" size={13} />
                    Upgrade to Pro
                  </Button>
                </div>
              </AIInsight>
            )}
          </div>

          {/* Right: Scout AI read + per-phase scoring */}
          <div className="flex flex-col gap-6">
            <AIInsight heading={insight.heading} confidence="medium">
              {insight.body}
            </AIInsight>

            {SCORING_GROUPS.map((group) => (
              <ScoringSection key={group.title} title={group.title}>
                {group.fields.map((field) => (
                  <ScoreRow
                    key={field.key}
                    field={field}
                    value={rules[field.key]}
                    disabled={!canCustomize}
                    onChange={(value) => applyRuleChange(field.key, value)}
                  />
                ))}
              </ScoringSection>
            ))}

            {canCustomize && (
              <div className="flex justify-end gap-[5px]">
                <Button variant="stroke" size="md" onClick={handleReset}>
                  <Icon name="reset" size={13} />
                  Reset to default
                </Button>
                <Button
                  variant="blue"
                  size="md"
                  disabled={mode !== 'custom' || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  <Icon name="save" size={13} />
                  {saveMutation.isPending ? 'Saving…' : 'Save scoring'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------- Score row ------------------------------ */

function ScoreRow({
  field,
  value,
  disabled,
  onChange,
}: {
  field: StatFieldMeta
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="flex min-h-[38px] items-center gap-3 border-t border-n-4 px-3.5 py-[5px] first:border-t-0">
      <span className="mr-auto min-w-0 truncate text-[11px] font-semibold text-ink">
        {field.label}
      </span>
      <span className="shrink-0 text-[10px] font-medium text-n-6">
        {field.unit}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Decrease ${field.label}`}
          onClick={() => onChange(value - field.step)}
        >
          <Icon name="minus-circle" size={13} />
        </Button>
        <span
          className={cn(
            'fs-num min-w-11 text-center text-[12px] font-bold',
            value < 0 ? 'text-negative-strong' : 'text-ink',
          )}
        >
          {formatPoints(value)}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Increase ${field.label}`}
          onClick={() => onChange(value + field.step)}
        >
          <Icon name="plus-circle" size={13} />
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------ Section shell ---------------------------- */

const FIELD_LABEL = 'text-[11px] font-semibold leading-tight'

/** Settings section — 14px bold title over a hairline-bordered row group. */
function ScoringSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-[9px]">
      <h2 className="text-[14px] font-bold tracking-[-0.015em] text-ink">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-n-4 bg-white">
        {children}
      </div>
    </section>
  )
}

/* -------------------------------- Skeleton ------------------------------- */

function ScoringSkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.3fr]">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-64 rounded-2xl bg-surface-control" />
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-28 rounded-2xl bg-surface-control" />
        <Skeleton className="h-44 rounded-2xl bg-surface-control" />
        <Skeleton className="h-36 rounded-2xl bg-surface-control" />
      </div>
    </div>
  )
}
