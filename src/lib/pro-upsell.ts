/**
 * Does the app offer Pro to anyone?
 *
 * OFF while Pro is on hold: the 2026 launch is free-only and builds no
 * billing (CLAUDE.md, Key Business Rules). Redesign leftover #23 (Chris,
 * 2026-10-27): the account menu offered everyone "Upgrade to Pro", and the
 * page it opened sold perks that are all free now. With this switch off:
 *  - the account menu has no "Upgrade to Pro";
 *  - the Pro subscription page (`/app/settings/billing`, desktop and phone)
 *    sends you to Account settings, even from a typed or saved link
 *    (`settings/billing/layout.tsx`);
 *  - the scoring page's Pro card, which only shows if custom scoring goes
 *    back to Pro-only (`CUSTOM_SCORING_PRO_ONLY`), has no Upgrade button.
 *
 * Nothing is deleted. The menu item, both Pro subscription screens and their
 * copy stay in place behind this switch, and the `is_pro` column and checks
 * are untouched. A Pro tier brings the offer back by setting this to true,
 * after rewriting `PRO_FEATURES` / `PRO_PLAN_COPY` in
 * `components/settings/account-settings-ops.ts`, which still list things
 * every account gets for free today.
 */
export const PRO_UPSELL_ENABLED = false
