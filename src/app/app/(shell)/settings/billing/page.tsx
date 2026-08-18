'use client'

import { useRouter } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { AIInsight } from '@/components/ui/ai-insight'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
 * Pro subscription — outside-the-nav settings page. The upgrade CTA is an
 * accent-blue Pro moment in the Scout AI voice (AI/Pro moments are always
 * ultramarine, never lime).
 */
export default function BillingSettingsPage() {
  const router = useRouter()
  const { profile, isLoading } = useAuth()
  const { toast } = useToast()

  const isPro = Boolean(profile?.is_pro)

  return (
    <div className="max-w-[560px]">
      <PageHeader title="Pro subscription" />

      <div className="mb-4">
        <Button variant="stroke" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      </div>

      {isLoading || !profile ? (
        <Skeleton className="h-72" />
      ) : isPro ? (
        <Card>
          <CardHeader>
            <CardTitle>Your plan</CardTitle>
            <Badge variant="accent">Pro</Badge>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] font-bold leading-tight">
              You&apos;re on FieldScout Pro
            </p>
            <p className="mt-0.5 text-[12px] font-medium text-n-3">
              {profile.subscription_status
                ? `Subscription status: ${profile.subscription_status}`
                : 'Every scouting tool is unlocked.'}
            </p>
            <ul className="mt-4 space-y-2 border-t border-n-4 pt-4">
              {PRO_FEATURES.map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-2 text-[13px] font-medium"
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
            <p className="mt-4 border-t border-n-4 pt-4 text-[12px] font-medium text-n-3">
              Billing management is on the way — invoices and plan changes will
              live here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Your plan</CardTitle>
            <Badge variant="stroke">Free</Badge>
          </CardHeader>
          <CardContent>
            <AIInsight heading="Go Pro — unlock the full scouting department.">
              Private lists without limits, every weekly position, leagues, and
              scoring built your way.
            </AIInsight>

            <ul className="mt-4 space-y-2">
              {PRO_FEATURES.map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-2 text-[13px] font-medium"
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

            <div className="mt-4 border-t border-n-4 pt-4">
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
          </CardContent>
        </Card>
      )}
    </div>
  )
}
