'use client'

import Link from 'next/link'

import { ChoiceSelect, FieldRow, SettingsSkin, ToggleRow } from '@/components/leagues/settings-form-controls'
import { CenteredNote } from '@/components/mobile/league/league/league-bits'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { M_TEXT_FIELD, MStepper } from '@/components/mobile/ui/m-form'
import { MobileScreen, MPageBar } from '@/components/mobile/ui/mobile-header'
import { useScoringEditor } from '@/hooks/use-scoring-editor'
import { PRO_UPSELL_ENABLED } from '@/lib/pro-upsell'
import { SCORING_PRESETS } from '@/lib/scoring/default'
import {
  PRO_SCORING_UPSELL,
  SCORING_GROUPS,
  SYSTEM_NAME_MAX,
  formatPoints,
  systemNameHint,
  systemNameValue,
} from '@/lib/scoring/scoring-editor'
import { cn } from '@/lib/utils'

import { ScoutAiCard, SettingsField, SettingsGroup, SettingsSkeleton, settingsButtonClass } from './settings-parts'

/** Scoring's parent: Settings, which opens it. */
export const SCORING_PARENT = '/app/settings'

/** Why Save is off while a platform preset is showing (prevent, don't
 *  refuse: the button says nothing, this line says what to do). */
export const SAVE_NEEDS_CUSTOM = 'Change any value to save it as your own system.'

/**
 * Settings › Scoring on the phone (gap list §4 item 101) — the same builder
 * as desktop (`useScoringEditor`: presets for everyone, a custom system you
 * tune and save through `PUT /api/scoring-systems`), in the phone's own
 * screen. A 52px bar (blue back chevron, "Scoring"), then Basic settings —
 * the system's name, the scoring type (the phone's own picker) and Full PPR
 * — the Scout AI read on those values, each phase's values as − / + rows,
 * and Reset to default / Save scoring. Any value edit turns a preset into
 * your custom system, as on desktop; Save is on only for a custom system.
 *
 * If your saved system can't be read the screen says so and offers Try
 * again — it never opens on the default values as if you had none (a Save
 * from there would replace your system). Back goes to where you came from,
 * else Settings.
 */
export function MobileScoringSettings() {
  const goBack = useGoBack()
  const editor = useScoringEditor()
  const header = <MPageBar title="Scoring" onBack={() => goBack(SCORING_PARENT)} />

  if (editor.loadFailed) {
    return (
      <MobileScreen header={header}>
        <CenteredNote role="alert" message="Couldn’t load your scoring." action="Try again" onAction={editor.retryLoad} />
      </MobileScreen>
    )
  }
  if (editor.isPageLoading) {
    return (
      <MobileScreen header={header}>
        <SettingsSkeleton blocks={['row', 'row', 'row', 'card', 'card', 'card']} />
      </MobileScreen>
    )
  }

  const { canCustomize, mode, name, setName, rules, changeMode, changeRule, reset, save, insight, isFullPpr } = editor
  const isCustom = mode === 'custom'
  const typeOptions = [
    ...SCORING_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
    ...(editor.showCustomOption ? [{ value: 'custom', label: editor.customLabel }] : []),
  ]

  return (
    <MobileScreen header={header}>
      <SettingsSkin layout="mobile">
        <div className="flex flex-col gap-[18px] px-4 pb-8 pt-2" data-scoring-settings>
          <SettingsGroup title="Basic settings">
            <SettingsField label="System name" htmlFor="m-scoring-name" hint={systemNameHint(mode)}>
              <input
                id="m-scoring-name"
                value={systemNameValue(mode, name)}
                onChange={(event) => setName(event.target.value)}
                maxLength={SYSTEM_NAME_MAX}
                disabled={!canCustomize || !isCustom}
                autoComplete="off"
                enterKeyHint="done"
                className={M_TEXT_FIELD}
              />
            </SettingsField>
            <FieldRow label="Scoring type" htmlFor="m-scoring-type">
              <ChoiceSelect id="m-scoring-type" value={mode} options={typeOptions} onValueChange={changeMode} />
            </FieldRow>
            <ToggleRow
              id="m-scoring-full-ppr"
              label="Full PPR"
              hint="1 point per reception"
              checked={isFullPpr}
              onCheckedChange={(checked) => changeRule('receptions', checked ? 1 : 0)}
              disabled={!canCustomize}
            />
          </SettingsGroup>

          {!canCustomize && (
            <ScoutAiCard heading={PRO_SCORING_UPSELL.heading} label="Pro">
              <p>{PRO_SCORING_UPSELL.body}</p>
              {/* No Upgrade while the app offers no Pro (`PRO_UPSELL_ENABLED`). */}
              {PRO_UPSELL_ENABLED && (
                <Link
                  href="/app/settings/billing"
                  className="mt-3 flex h-10 w-fit items-center rounded-pill bg-accent px-[18px] text-[14px] font-semibold text-white active:bg-accent-strong"
                >
                  Upgrade to Pro
                </Link>
              )}
            </ScoutAiCard>
          )}

          <ScoutAiCard heading={insight.heading} label="Scout AI · Medium confidence">
            {insight.body}
          </ScoutAiCard>

          {SCORING_GROUPS.map((group) => (
            <SettingsGroup key={group.title} title={group.title}>
              {group.fields.map((field) => {
                const value = rules[field.key]
                return (
                  <FieldRow key={field.key} label={field.label} hint={field.unit}>
                    <MStepper
                      value={value}
                      step={field.step}
                      format={formatPoints}
                      onStep={(next) => changeRule(field.key, next)}
                      ariaLabel={`${field.label} points`}
                      appearance="field"
                      disabled={!canCustomize}
                      valueClassName={cn('min-w-[48px]', value < 0 ? 'text-m-red' : 'text-m-t1')}
                    />
                  </FieldRow>
                )
              })}
            </SettingsGroup>
          ))}

          {canCustomize && (
            <div className="flex flex-col gap-2.5" data-scoring-actions>
              {!isCustom && (
                <p className="text-center text-[12px] font-medium text-m-t3" data-scoring-save-why>
                  {SAVE_NEEDS_CUSTOM}
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={reset} className={cn(settingsButtonClass('quiet'), 'flex-1')}>
                  Reset to default
                </button>
                <button
                  type="button"
                  onClick={() => save.mutate()}
                  disabled={!isCustom || save.isPending}
                  className={cn(settingsButtonClass('primary', isCustom), 'flex-1')}
                  data-scoring-save
                >
                  {save.isPending ? 'Saving…' : 'Save scoring'}
                </button>
              </div>
            </div>
          )}
        </div>
      </SettingsSkin>
    </MobileScreen>
  )
}
