'use client'

import { CenteredNote } from '@/components/mobile/league/league/league-bits'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen, MPageBar } from '@/components/mobile/ui/mobile-header'
import {
  CHECKOUT_SOON_TOAST,
  PRO_FEATURES,
  PRO_PLAN_COPY,
  proStatusLine,
} from '@/components/settings/account-settings-ops'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { ScoutAiCard, SettingsChip, SettingsGroup, SettingsSkeleton, settingsButtonClass } from './settings-parts'

/** Pro subscription's parent: Settings. */
export const BILLING_PARENT = '/app/settings'

/**
 * Settings › Pro subscription on the phone (gap list §4 item 101) — the same
 * page as desktop's `/app/settings/billing`, which Pro's suspension leaves
 * restyled only (CLAUDE.md, free-only launch): your plan with its Free / Pro
 * chip, what Pro includes, and — on Free — Upgrade to Pro, which still says
 * checkout is almost ready (there is no checkout yet). Back goes to where
 * you came from, else Settings.
 */
export function MobileBillingSettings() {
  const goBack = useGoBack()
  const { profile, isLoading } = useAuth()
  const { toast } = useToast()
  const header = <MPageBar title="Pro subscription" onBack={() => goBack(BILLING_PARENT)} />

  if (isLoading) {
    return (
      <MobileScreen header={header}>
        <SettingsSkeleton blocks={['card', 'row', 'row', 'row']} />
      </MobileScreen>
    )
  }
  if (!profile) {
    return (
      <MobileScreen header={header}>
        <CenteredNote role="alert" message="We couldn’t load your account. Refresh to try again." />
      </MobileScreen>
    )
  }

  const isPro = Boolean(profile.is_pro)
  return (
    <MobileScreen header={header}>
      <div className="flex flex-col gap-[18px] px-4 pb-8 pt-2" data-billing-settings>
        <SettingsGroup
          title="Your plan"
          aside={<SettingsChip tone={isPro ? 'accent' : 'quiet'}>{isPro ? 'Pro' : 'Free'}</SettingsChip>}
        >
          <div className="flex flex-col gap-3 pt-1.5">
            {isPro ? (
              <div className="flex flex-col gap-0.5">
                <p className="text-[15px] font-semibold text-m-t1">{PRO_PLAN_COPY.proTitle}</p>
                <p className="text-[12px] font-medium text-m-t3">{proStatusLine(profile.subscription_status)}</p>
              </div>
            ) : (
              <ScoutAiCard heading={PRO_PLAN_COPY.freeHeading}>{PRO_PLAN_COPY.freeBody}</ScoutAiCard>
            )}
            <ul className="flex flex-col" data-billing-features>
              {PRO_FEATURES.map((feature) => (
                <li
                  key={feature}
                  className="flex min-h-[44px] items-center gap-2.5 border-b border-m-b2 text-[14px] font-medium text-m-t1 last:border-b-0"
                >
                  <MIcon
                    name="check"
                    size={16}
                    stroke={2.2}
                    className={cn('flex-none', isPro ? 'text-m-green' : 'text-accent')}
                  />
                  {feature}
                </li>
              ))}
            </ul>
            {isPro ? (
              <p className="text-[12px] font-medium leading-[1.35] text-m-t3">{PRO_PLAN_COPY.proBillingSoon}</p>
            ) : (
              <button
                type="button"
                onClick={() => toast(CHECKOUT_SOON_TOAST)}
                className={settingsButtonClass('primary')}
                data-billing-upgrade
              >
                Upgrade to Pro
              </button>
            )}
          </div>
        </SettingsGroup>
      </div>
    </MobileScreen>
  )
}
