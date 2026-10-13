'use client'

import { useRouter } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { AIInsight } from '@/components/ui/ai-insight'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'

const PRO_FEATURES = [
  'Unlimited private lists',
  'Unlimited teams',
  'Rank every position, every week',
  'Leagues — create and join',
  'Custom scoring systems',
]

/**
 * Pro subscription — outside-the-nav settings page, in the v7 Account
 * settings language (14px bold section title over a hairline-bordered
 * group). The upgrade CTA is an accent-blue Pro moment in the Scout AI
 * voice. Pro is suspended for launch — restyled only; copy and gating
 * unchanged.
 */
export default function BillingSettingsPage() {
  const router = useRouter()
  const { profile, isLoading } = useAuth()
  const { toast } = useToast()

  const isPro = Boolean(profile?.is_pro)

  return (
    <div className="max-w-[612px] pb-[54px]">
      <PageHeader title="Pro subscription" />

      <div className="mb-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      </div>

      {isLoading || !profile ? (
        <Skeleton className="h-72 rounded-2xl bg-surface-control" />
      ) : isPro ? (
        <PlanSection badge={<Badge variant="accent">Pro</Badge>}>
          <div className="px-3.5 py-3">
            <p className="text-[12px] font-bold leading-tight text-ink">
              You&apos;re on FieldScout Pro
            </p>
            <p className="mt-0.5 text-[10px] font-medium text-n-6">
              {profile.subscription_status
                ? `Subscription status: ${profile.subscription_status}`
                : 'Every scouting tool is unlocked.'}
            </p>
          </div>
          <ul className="space-y-2 border-t border-n-4 px-3.5 py-3">
            {PRO_FEATURES.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-2 text-[11px] font-medium text-ink"
              >
                <Icon
                  name="check"
                  size={13}
                  className="shrink-0 text-positive-strong"
                />
                {feature}
              </li>
            ))}
          </ul>
          {/* TODO(stripe): link the Stripe customer portal once billing
              management ships. */}
          <p className="border-t border-n-4 px-3.5 py-3 text-[10px] font-medium text-n-6">
            Billing management is on the way — invoices and plan changes will
            live here.
          </p>
        </PlanSection>
      ) : (
        <PlanSection badge={<Badge variant="stroke">Free</Badge>}>
          <div className="px-3.5 py-3">
            <AIInsight heading="Go Pro — unlock the full scouting department.">
              Private lists without limits, every weekly position, leagues, and
              scoring built your way.
            </AIInsight>

            <ul className="mt-3 space-y-2">
              {PRO_FEATURES.map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-2 text-[11px] font-medium text-ink"
                >
                  <Icon
                    name="check"
                    size={13}
                    className="shrink-0 text-accent"
                  />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end border-t border-n-4 px-3.5 py-2.5">
            {/* TODO(stripe): no checkout flow exists yet — wire Stripe
                Checkout here when billing ships. */}
            <Button
              variant="blue"
              onClick={() =>
                toast({
                  title: 'Checkout is almost ready',
                  description:
                    'Pro upgrades open soon — your scouting file is safe with us.',
                })
              }
            >
              <Icon name="star" size={14} />
              Upgrade to Pro
            </Button>
          </div>
        </PlanSection>
      )}
    </div>
  )
}

/** v7 settings section: 14px bold title + badge over a hairline group. */
function PlanSection({
  badge,
  children,
}: {
  badge: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-[9px]">
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-bold tracking-[-0.015em] text-ink">
          Your plan
        </h2>
        {badge}
      </div>
      <div className="overflow-hidden rounded-2xl border border-n-4 bg-white">
        {children}
      </div>
    </section>
  )
}
