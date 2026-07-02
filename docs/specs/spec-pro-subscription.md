# Spec: Pro Subscription

## Phase
Phase 4 — Pro Subscription

## Overview

Stripe-powered subscription that unlocks all premium features. Monthly and annual billing options, 7-day free trial, and a customer portal for managing subscriptions.

---

## Features

### Stripe Integration
- Checkout Sessions for new subscriptions
- Customer Portal for managing existing subscriptions, viewing invoices, and cancelling
- Webhooks to keep `profiles.is_pro` in sync with Stripe subscription status

### Pricing Page
- Monthly and annual options (annual at a discount)
- Feature comparison table (Free vs. Pro)
- 7-day free trial on first subscription

### Billing Settings Page
- Current plan status
- Next billing date
- Manage subscription (opens Stripe Customer Portal)
- View invoice history

### Pro Gate Enforcement
- Audit and enforce `is_pro` checks on all gated features:
  - Private lists beyond 1
  - Teams beyond 1
  - Custom scoring systems beyond 1
  - Leagues (Phase 8)
  - Ask AI (Phase 9)
  - AI List Generation (Phase 1)
  - YouTube Highlights embedded player (Phase 3)

### Upgrade Prompts
- Contextual CTAs at every free tier limit (e.g. "You've reached your 1 private list limit. Upgrade to Pro for unlimited private lists.")
- Upgrade modal with a one-click path to the pricing page

---

## Business Rules

- `is_pro` is the single source of truth for feature gating (set by Stripe webhook)
- 7-day free trial: one per customer lifetime
- Cancellation: Pro access continues until end of billing period

---

## API Keys Needed
- `STRIPE_SECRET_KEY` — server-side Stripe API
- `STRIPE_PUBLISHABLE_KEY` — client-side Stripe.js
- `STRIPE_WEBHOOK_SECRET` — webhook signature verification

---

## UI Components

- `src/app/(app)/pricing/page.tsx`
- `src/app/(app)/settings/billing/page.tsx`
- `src/components/upgrade/upgrade-modal.tsx`
- `src/components/upgrade/upgrade-prompt.tsx` (inline CTA)
- `app/api/stripe/checkout/route.ts`
- `app/api/stripe/portal/route.ts`
- `app/api/stripe/webhook/route.ts`
