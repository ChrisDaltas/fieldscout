'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { LeagueSettings } from '@/lib/leagues/settings/league-settings'
import { WAIVER_PRESETS, WEEKDAYS, describeWaiverSchedule, matchWaiverPreset, type Weekday } from '@/lib/leagues/time/waiver-schedule'

import { ChoiceSelect, FieldRow } from './settings-form-controls'
import {
  FREE_AGENCY_OPTIONS,
  WEEKDAY_SHORT,
  presetPatch,
  toggleRunDay,
  zoneOptions,
  type ScheduleSettings,
} from './waiver-claims-ops'

/**
 * The waiver schedule's form rows — spec §7.3.4 (v2.16.59, Q70), M5 task
 * L.D2.13 (PROGRESS F425: "the full schedule editor"). ONE set of rows for
 * both surfaces (CLAUDE.md: no near-duplicates): the create wizard shows the
 * preset pick alone (`detail={false}`); the settings panel shows it and the
 * schedule itself — run days × one time in the league's zone, and when free
 * agency opens. Every value is validated again by the settings contract and
 * the server; these rows only shape the patch.
 */
export function WaiverScheduleFields({
  s,
  onSettings,
  detail = true,
  idPrefix = 'set',
}: {
  s: ScheduleSettings
  onSettings: (patch: Partial<LeagueSettings>) => void
  /** false = the preset pick only (the create wizard). */
  detail?: boolean
  idPrefix?: string
}) {
  const matched = matchWaiverPreset(s)
  const showDetail = detail && s.waiver_type !== 'none_fcfs'
  return (
    <div className="flex flex-col gap-2.5" data-waiver-schedule-fields>
      <FieldRow label="Schedule" htmlFor={`${idPrefix}-waiver-schedule`} hint={describeWaiverSchedule(s)}>
        <ChoiceSelect
          id={`${idPrefix}-waiver-schedule`}
          ariaLabel="Waiver schedule"
          width="w-72"
          value={matched ?? 'custom'}
          options={[
            ...WAIVER_PRESETS.map((p) => ({ value: p.id, label: p.label })),
            ...(matched === null ? [{ value: 'custom', label: 'Custom schedule' }] : []),
          ]}
          onValueChange={(v) => {
            const patch = presetPatch(v, s)
            if (patch) onSettings(patch)
          }}
        />
      </FieldRow>

      {showDetail && (
        <>
          <FieldRow label="Waivers run on" hint="Pick one or more days.">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Waiver run days" data-run-days={s.waiver_run_days.join(',')}>
              {WEEKDAYS.map((d: Weekday) => {
                const on = s.waiver_run_days.includes(d)
                return (
                  <Button
                    key={d}
                    type="button"
                    variant="stroke"
                    size="sm"
                    aria-pressed={on}
                    className={on ? 'bg-accent-soft' : undefined}
                    onClick={() => onSettings({ waiver_run_days: toggleRunDay(s.waiver_run_days, d) })}
                  >
                    {WEEKDAY_SHORT[d]}
                  </Button>
                )
              })}
            </div>
          </FieldRow>
          <FieldRow label="At" htmlFor={`${idPrefix}-waiver-time`}>
            <span className="flex items-center gap-2">
              <Input
                id={`${idPrefix}-waiver-time`}
                type="time"
                step={60}
                value={s.waiver_run_time}
                onChange={(e) => e.target.value && onSettings({ waiver_run_time: e.target.value.slice(0, 5) })}
                className="h-btn-md w-28 text-[12px]"
              />
              <ChoiceSelect
                ariaLabel="Waiver time zone"
                width="w-36"
                value={s.waiver_time_zone}
                options={zoneOptions(s.waiver_time_zone)}
                onValueChange={(waiver_time_zone) => onSettings({ waiver_time_zone })}
              />
            </span>
          </FieldRow>
          <FieldRow label="Free agency opens" htmlFor={`${idPrefix}-fa-opens`} hint="It always closes when the week’s last game ends.">
            <ChoiceSelect
              id={`${idPrefix}-fa-opens`}
              ariaLabel="When free agency opens"
              width="w-56"
              value={s.free_agency_opens}
              options={FREE_AGENCY_OPTIONS}
              onValueChange={(v) => onSettings({ free_agency_opens: v as LeagueSettings['free_agency_opens'] })}
            />
          </FieldRow>
          {s.free_agency_opens === 'day_and_time' && (
            <FieldRow label="Opens on" htmlFor={`${idPrefix}-fa-day`}>
              <span className="flex items-center gap-2">
                <ChoiceSelect
                  id={`${idPrefix}-fa-day`}
                  ariaLabel="Free agency opening day"
                  width="w-28"
                  value={s.free_agency_open_day}
                  options={WEEKDAYS.map((d) => ({ value: d, label: WEEKDAY_SHORT[d] }))}
                  onValueChange={(v) => onSettings({ free_agency_open_day: v as Weekday })}
                />
                <Input
                  aria-label="Free agency opening time"
                  type="time"
                  step={60}
                  value={s.free_agency_open_time}
                  onChange={(e) => e.target.value && onSettings({ free_agency_open_time: e.target.value.slice(0, 5) })}
                  className="h-btn-md w-28 text-[12px]"
                />
              </span>
            </FieldRow>
          )}
        </>
      )}
    </div>
  )
}
