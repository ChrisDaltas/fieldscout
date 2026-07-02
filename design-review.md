# FieldScout — Design Review
**Date:** April 10, 2026 | **Scope:** Full codebase (auth flows, app shell, landing page)
**Skills applied:** Design Critique · Accessibility Review (WCAG 2.1 AA) · UX Copy · Design Handoff

---

## 1. Design Critique

### Overall Impression
The auth flow is the strongest part of the UI — clean, consistent, and well-structured. The landing page and app shell are essentially empty placeholders that will need significant investment before public launch. The design system foundation (shadcn/ui + Tailwind tokens) is solid and will scale well.

### Usability

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| Landing page has zero CTAs | 🔴 Critical | Add "Sign up free" and "Sign in" buttons. Users who land on `/` have no path forward. |
| App dashboard is a placeholder | 🔴 Critical | Even a skeleton of the real navigation/features is needed so auth-ed users aren't confused. |
| Loading button label doesn't change | 🟡 Moderate | When `isLoading` is true, update the button label to "Signing in…" / "Creating account…" so users know the action fired. |
| No password strength indicator on signup | 🟡 Moderate | An inline strength meter reduces abandonment and teaches users the 8-char requirement before they hit the error. |
| "Confirm password do not match" is only checked on submit | 🟡 Moderate | Validate on blur so users don't have to submit to find out. |
| No resend confirmation email button | 🟡 Moderate | The "Didn't receive the email? Try again" flow resets state to the form, not to a dedicated resend action. |
| Forgot-password uses raw Supabase error messages | 🟡 Moderate | `signInError.message` can expose implementation details ("Invalid login credentials"). Map to friendly copy. |
| No success feedback after password reset | 🟡 Moderate | After `updateUser`, router.push('/app') silently succeeds. Show a toast confirming the change. |
| Username page "Continue" button disabled with no explanation | 🟢 Minor | If the button is disabled because the username is unavailable vs. invalid, the user can see why from the hint text — but consider also disabling the hint animation until a valid username is entered. |

### Visual Hierarchy

**What draws the eye first:** On auth pages, the card title ("Welcome back", "Create your account") draws focus correctly. The brand mark above the card sets context well.

**Reading flow:** Title → description → form fields → CTA → escape link. This is the correct auth convention and the implementation follows it cleanly.

**Emphasis:** The primary CTA (submit button) is full-width and high-contrast — this is correct. "Forgot password?" is appropriately de-emphasized at `text-xs text-muted-foreground`.

**Landing page:** There is no hierarchy beyond a centered `h1`. The page needs a hero section with a value prop, feature highlights, and primary/secondary CTAs.

### Consistency

| Element | Issue | Recommendation |
|---------|-------|----------------|
| App layout logo uses "FIELDSCOUT" (all caps) | Auth layout also uses "FIELDSCOUT" (all caps) — consistent ✅ | No change needed. |
| Error rendering | All forms use the same `rounded-md bg-destructive/10 px-3 py-2` pattern ✅ | No change needed. |
| `CardDescription` tone varies | Login: "Sign in to your account" (instructional). Signup: "Start ranking players in seconds" (value-oriented). | Align — either both are instructional or both lead with value. |
| Auth layout subtitle | "Fantasy football, ranked." only appears in `(auth)/layout.tsx` — not on the landing page | Move/duplicate into the landing page hero. |
| Button loading pattern | Login uses `Loader2` icon inside button with static "Sign in" label. A `aria-live` change would make this more consistent and accessible. | Covered in UX Copy section. |

### What Works Well
- The gradient background (`bg-gradient-to-b from-background to-secondary/20`) on auth pages is subtle and professional.
- `max-w-sm` container on auth cards is correct width for form-only flows.
- Email confirmation state after signup (the mail icon card) is a great pattern — clears the form, resets expectations.
- Avatar fallback initials logic in `UserNav` is thoughtful (handles display name vs. username).
- Debounced username availability check (400ms) is the right UX pattern.

### Priority Recommendations
1. **Build the landing page** — Add a hero section with value prop, feature list, and CTAs. The current page is a dead end for new visitors.
2. **Map auth errors to friendly copy** — Raw Supabase messages ("Invalid login credentials") erode trust. Create a small error map utility (see UX Copy section).
3. **Animate button labels during loading** — "Sign in" → "Signing in…" is a one-line change that meaningfully improves perceived responsiveness.

---

## 2. Accessibility Audit (WCAG 2.1 AA)

**Standard:** WCAG 2.1 AA | **Date:** April 10, 2026

### Summary
**Issues found:** 9 | **Critical:** 2 | **Major:** 4 | **Minor:** 3

### Perceivable

| # | Issue | WCAG Criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| 1 | Error `<div>` has no `role="alert"` — screen readers won't announce login/signup errors automatically | 1.3.1 Info and Relationships | 🔴 Critical | Add `role="alert"` (or `aria-live="assertive"`) to all error message divs across auth pages |
| 2 | Username availability status (Check/X icon) is icon-only with no accessible label | 1.1.1 Non-text Content | 🔴 Critical | Wrap the status icon in a `<span className="sr-only">` sibling: "Username available" / "Username taken" |
| 3 | `green-500` used for success text on username page is a hardcoded color, not a design token | 1.4.3 Contrast | 🟡 Major | Verify contrast of `green-500` (#22c55e) on white background — it's 2.5:1, which **fails** AA for small text. Use `green-600` (#16a34a, 4.0:1) minimum, or `green-700` (#15803d, 5.4:1) for comfortable pass. |

### Operable

| # | Issue | WCAG Criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| 4 | `TopNav` renders a `<header>` but has no `<nav>` landmark | 2.4.1 Bypass Blocks | 🟡 Major | Wrap the navigation links/actions in `<nav aria-label="Main navigation">` |
| 5 | No skip-to-main-content link | 2.4.1 Bypass Blocks | 🟡 Major | Add `<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to content</a>` as first element in root layout, and `id="main-content"` on `<main>` |
| 6 | `UserNav` avatar `<Button>` has no accessible name | 4.1.2 Name, Role, Value | 🟡 Major | Add `aria-label={profile?.display_name ?? profile?.username ?? 'User menu'}` to the trigger button |
| 7 | Auth `<main>` area has no `id` for skip link target | 2.4.1 Bypass Blocks | 🟢 Minor | Add `id="main-content"` to the auth layout's wrapper div |

### Understandable

| # | Issue | WCAG Criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| 8 | Username availability `<p>` messages are not in an `aria-live` region — screen reader users typing a username won't hear the "available/taken" feedback | 3.3.1 Error Identification | 🟡 Major | Wrap the status `<p>` elements in `<div aria-live="polite" aria-atomic="true">` |
| 9 | Password fields have no hint text about the 8-character requirement until after a failed submission | 3.3.2 Labels or Instructions | 🟢 Minor | Add `<p className="text-xs text-muted-foreground">At least 8 characters</p>` below the password field (before confirm), making the rule visible upfront |

### Color Contrast Check

| Element | Foreground | Background | Ratio | Required | Pass? |
|---------|-----------|------------|-------|----------|-------|
| Body text (`foreground`) | `hsl(240 10% 3.9%)` ≈ #0a0a0f | `hsl(0 0% 100%)` #ffffff | ~20:1 | 4.5:1 | ✅ |
| Muted foreground | `hsl(240 3.8% 46.1%)` ≈ #717180 | #ffffff | ~4.6:1 | 4.5:1 | ✅ (barely) |
| Destructive text | `hsl(0 84.2% 60.2%)` ≈ #f04545 | `hsl(0 84.2% 60.2%/10%)` ≈ #fdeaea | ~3.2:1 | 4.5:1 | ❌ |
| `green-500` success text | #22c55e | #ffffff | ~2.5:1 | 4.5:1 | ❌ |
| Primary button text | `hsl(0 0% 98%)` #fafafa | `hsl(240 5.9% 10%)` #191921 | ~17:1 | 4.5:1 | ✅ |

**Two contrast failures to fix:**
- **Destructive error text** inside `bg-destructive/10` — the `text-destructive` color on the light destructive background doesn't meet 4.5:1. Fix: darken the text with `text-red-700` or remove the colored background and use a border + icon pattern instead.
- **`green-500`** success text — use `text-green-700` (`#15803d`) which achieves 5.4:1.

### Keyboard Navigation

| Element | Tab Order | Enter/Space | Escape |
|---------|-----------|-------------|--------|
| Auth form fields | Sequential ✅ | Submits form on Enter ✅ | N/A |
| "Forgot password?" link | Reached by Tab ✅ | Navigates ✅ | N/A |
| Submit button | Reached by Tab ✅ | Submits ✅ | N/A |
| `UserNav` dropdown trigger | Reached by Tab ✅ | Opens menu (Radix) ✅ | Closes (Radix) ✅ |
| Dropdown menu items | Arrow keys (Radix) ✅ | Activates ✅ | Closes ✅ |

Keyboard navigation is generally solid thanks to shadcn/Radix. The main gaps are the missing skip link and nav landmark.

### Priority Fixes
1. **`role="alert"` on error messages** — Every auth form has this gap. One-line fix, high impact for screen reader users.
2. **`green-500` → `green-700` for success text** — Contrast failure; replace across username page and anywhere else success color is used.
3. **`aria-live` region for username availability** — Users typing a username need to hear "available" / "taken" without moving focus.
4. **`aria-label` on avatar button** — The UserNav trigger has no name, making it a mystery to screen readers.
5. **Skip-to-content link** — Add once in `app/layout.tsx` to benefit the entire app.

---

## 3. UX Copy Review

### Auth Error Messages

The biggest copy problem is passing raw Supabase error strings directly to the UI. Here's a mapping to use:

```typescript
// utils/auth-errors.ts
const AUTH_ERROR_MAP: Record<string, string> = {
  'Invalid login credentials':
    'Email or password is incorrect. Please try again.',
  'Email not confirmed':
    'Please confirm your email before signing in. Check your inbox.',
  'User already registered':
    'An account with this email already exists. Try signing in.',
  'Password should be at least 6 characters':
    'Password must be at least 8 characters.',
  'signup_disabled':
    'New signups are temporarily disabled. Check back soon.',
  'over_email_send_rate_limit':
    'Too many emails sent. Please wait a few minutes and try again.',
}

export function friendlyAuthError(message: string): string {
  return AUTH_ERROR_MAP[message] ?? 'Something went wrong. Please try again.'
}
```

### Page-by-Page Copy Recommendations

#### Login Page

| Element | Current | Recommended | Rationale |
|---------|---------|-------------|-----------|
| `CardTitle` | "Welcome back" | "Welcome back" ✅ | Keep — warm and concise |
| `CardDescription` | "Sign in to your account" | "Sign in to your FieldScout account" | Adds brand context on a shared-device scenario |
| Submit button (loading) | "Sign in" | "Signing in…" | Communicates that the action is in progress |
| Error state | Raw Supabase message | Use `friendlyAuthError()` map above | Prevents exposing implementation details |

#### Signup Page

| Element | Current | Recommended | Rationale |
|---------|---------|-------------|-----------|
| `CardDescription` | "Start ranking players in seconds" | "Start ranking players in seconds" ✅ | Keep — action-oriented, specific to the product |
| Submit button (loading) | "Create account" | "Creating account…" | Matches loading pattern |
| Password placeholder | "At least 8 characters" | "At least 8 characters" ✅ | Clear and upfront |
| Mismatch error | "Passwords do not match" | "Your passwords don't match. Please try again." | More conversational, less robotic |

#### Email Sent State (Signup)

| Element | Current | Recommended | Rationale |
|---------|---------|-------------|-----------|
| `CardTitle` | "Check your email" | "Check your email" ✅ | Clear |
| `CardDescription` | "We sent a confirmation link to **{email}**. Click the link to verify your account and get started." | "We sent a link to **{email}**. Click it to verify your account and you're in." | Shorter, friendlier, ends on a forward-looking note |
| Resend link | "Try again" | "Resend email" | "Try again" implies failure; "Resend" is the accurate action |

#### Forgot Password Page

| Element | Current | Recommended | Rationale |
|---------|---------|-------------|-----------|
| `CardTitle` | "Reset your password" | "Forgot your password?" | Matches the URL and the mental model of the user arriving at this page |
| `CardDescription` | "Enter your email and we'll send you a reset link" | "Enter your email and we'll send you a link to reset it." | Slightly more natural phrasing |
| Submit button | "Send reset link" | "Send reset link" ✅ | Specific and clear — keep |

#### Password Reset Email Sent State

| Element | Current | Recommended | Rationale |
|---------|---------|-------------|-----------|
| `CardDescription` | "We sent a password reset link to **{email}**. Click the link to set a new password." | "We sent a reset link to **{email}**. It expires in 1 hour." | Sets expectations on expiry (Supabase default is 1hr); removes redundancy |

#### Reset Password Page

| Element | Current | Recommended | Rationale |
|---------|---------|-------------|-----------|
| `CardTitle` | "Set new password" | "Set your new password" | More personal |
| `CardDescription` | "Enter your new password below" | "Choose a strong password — at least 8 characters." | More helpful; surfaces the requirement proactively |
| Submit button | "Update password" | "Save new password" | "Update" is slightly ambiguous (update what?); "Save" is concrete |

#### Username Page

| Element | Current | Recommended | Rationale |
|---------|---------|-------------|-----------|
| `CardDescription` | "This is how other players will find you" | "This is how other players will find you on FieldScout." | Adds brand context for clarity |
| Submit button | "Continue" | "Set username" | "Continue" is vague; "Set username" describes exactly what happens |
| Available message | "Username is available" | "✓ @{username} is available!" | Mirrors what users see on Twitter/etc.; more satisfying |
| Taken message | "Username is taken" | "@{username} is taken. Try another?" | Suggests a next action |
| Hint text | "3-30 characters. Letters, numbers, and underscores. Must start with a letter." | "3–30 characters · letters, numbers, underscores · must start with a letter" | Lighter punctuation; reads faster |

#### App Dashboard (placeholder)

| Element | Current | Recommended |
|---------|---------|-------------|
| `h1` | "Welcome to FieldScout" | "Welcome back, {username}" (once auth is wired) |
| Body | "Your fantasy football dashboard is coming soon." | Once real content exists, follow the empty-state pattern: what it is + why it's empty + how to start. E.g., "You don't have any lists yet. [Create your first list →]" |

#### TopNav — UserNav Dropdown

| Element | Current | Recommended | Rationale |
|---------|---------|-------------|-----------|
| "My Profile" | "My Profile" | "Profile" | Shorter; "my" is redundant in a personal dropdown |
| "Sign out" | "Sign out" | "Sign out" ✅ | Clear — keep |

---

## 4. Design Handoff Spec

### Auth Flow

#### Overview
A centered card-based auth flow with a persistent brand header. Used for login, signup, email confirmation, forgot password, password reset, and username selection. All screens share the same layout wrapper.

#### Layout

```
AuthLayout wrapper
  ├── Brand header (centered, mb-8)
  │     ├── h1 "FIELDSCOUT"          text-4xl font-bold tracking-tighter
  │     └── p "Fantasy football, ranked."  text-sm text-muted-foreground mt-1
  └── Card container              w-full max-w-sm
        └── [page-specific Card]
```

Full-page: `flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background to-secondary/20 px-4`

#### Design Tokens Used

| Token | CSS Variable | Light Value | Dark Value | Usage |
|-------|-------------|-------------|------------|-------|
| `background` | `--background` | `hsl(0 0% 100%)` | `hsl(240 10% 3.9%)` | Page background |
| `secondary/20` | `--secondary` at 20% | `hsl(240 4.8% 95.9%)` | `hsl(240 3.7% 15.9%)` | Gradient end |
| `card` | `--card` | `hsl(0 0% 100%)` | `hsl(240 10% 3.9%)` | Card background |
| `muted-foreground` | `--muted-foreground` | `hsl(240 3.8% 46.1%)` | `hsl(240 5% 64.9%)` | Description text, hints |
| `destructive` | `--destructive` | `hsl(0 84.2% 60.2%)` | `hsl(0 62.8% 30.6%)` | Error messages |
| `primary` | `--primary` | `hsl(240 5.9% 10%)` | `hsl(0 0% 98%)` | Submit button bg |
| `primary/10` | `--primary` at 10% | ~`hsl(240 5.9% 10%/10%)` | — | Email icon bg circle |
| `radius` | `--radius` | `0.5rem` | — | Card border radius (lg) |

#### Components

| Component | Variant/Usage | Key Props | Notes |
|-----------|--------------|-----------|-------|
| `Card` | Default | — | Full-width, max-w-sm container |
| `CardHeader` | `text-center` | — | All auth cards are center-aligned |
| `CardTitle` | `text-xl` | — | Page title |
| `CardDescription` | Default | — | Subtitle below title |
| `CardContent` | `space-y-4` | — | Holds form fields |
| `CardFooter` | `flex flex-col gap-4` | — | CTA + escape link |
| `Input` | Default | `type`, `autoComplete`, `required` | Always has associated `<label>` |
| `Button` | Default (primary) | `type="submit"`, `className="w-full"`, `disabled={isLoading}` | Full-width submit |
| `Loader2` | `animate-spin` | `className="animate-spin"` | Shown inside button when loading |

#### States and Interactions

| Element | State | Behavior |
|---------|-------|----------|
| Submit button | Default | Full-width, primary color |
| Submit button | Loading | Disabled + `Loader2` spinner prepended to label |
| Submit button | Disabled | 50% opacity (Tailwind `disabled:opacity-50` from shadcn) |
| Error message | Visible | Appears at top of `CardContent`, `bg-destructive/10 text-destructive`, `role="alert"` |
| Input | Default | `border-input` background |
| Input | Focus | `ring-2 ring-ring` via shadcn |
| Input | Invalid (HTML5) | Browser-native validation (overridden by JS) |
| Username status icon | Checking | `Loader2` spin, `text-muted-foreground` |
| Username status icon | Available | `Check`, `text-green-700` *(fix from green-500)* |
| Username status icon | Taken | `X`, `text-destructive` |

#### Responsive Behavior

| Breakpoint | Changes |
|------------|---------|
| Mobile (<640px) | Full width card with `px-4` side padding from layout |
| SM (≥640px) | Card width capped at `max-w-sm` (384px), centered |
| MD+ (≥768px) | No layout changes — auth is intentionally narrow |

#### Edge Cases

- **Long email addresses**: `CardDescription` truncates at card width; email is in `<strong>` — no truncation applied, wraps naturally.
- **Very long username**: `maxLength={30}` enforced on input; display truncated to 2 chars for initials in `UserNav`.
- **Network error during availability check**: Currently silently fails — consider adding `catch` to `checkAvailability` and setting `isAvailable = null` on error.
- **Session expired on username page**: `getUser()` returns null → sets generic error "You must be signed in." Redirect to `/login` would be better UX.

#### Animation / Motion

| Element | Trigger | Animation | Duration | Easing |
|---------|---------|-----------|----------|--------|
| `Loader2` in button | `isLoading = true` | CSS spin (360° rotation) | `1s` infinite | `linear` |
| Email sent card | State change | Instant replace (no transition) | — | — |
| Accordion (if used) | Open/close | Height 0 → content height | `0.2s` | `ease-out` |

#### Accessibility Notes
- All `<Input>` elements have explicit `<label htmlFor>` associations ✅
- `autoComplete` set appropriately on all inputs ✅
- Add `role="alert"` to error divs (see Accessibility Audit, finding #1)
- Add `aria-live="polite"` wrapper around username availability messages (finding #8)
- Add `aria-label` to `UserNav` avatar button (finding #6)
- Change `text-green-500` → `text-green-700` for WCAG contrast (finding #3)

---

### App Shell

#### Overview
Full-height layout with a sticky top navigation bar and a constrained content area. Currently minimal — no sidebar, no secondary navigation.

#### Layout

```
AppLayout
  ├── TopNav (sticky, z-50)
  │     ├── Logo link "FIELDSCOUT"
  │     └── UserNav (avatar dropdown)
  └── <main> (mx-auto max-w-7xl px-4 py-6)
        └── [page content]
```

#### TopNav Specs

| Property | Value |
|----------|-------|
| Position | `sticky top-0 z-50` |
| Height | `h-14` (56px) |
| Max width | `max-w-7xl` (1280px), centered |
| Background | `bg-background/95 backdrop-blur` with `supports-[backdrop-filter]:bg-background/60` |
| Border | `border-b` (`--border` token) |
| Horizontal padding | `px-4` (16px) |
| Logo | `text-lg font-bold tracking-tighter`, links to `/app` |

#### UserNav States

| State | Render |
|-------|--------|
| Loading | `<Skeleton className="h-8 w-8 rounded-full" />` |
| Unauthenticated | "Sign in" (ghost) + "Sign up" (primary) buttons, `gap-2` |
| Authenticated | Avatar button (h-8 w-8, rounded-full) → dropdown |

#### Dropdown Menu Items (authenticated)

1. Header: `display_name` (bold) + `@username` (muted)
2. Separator
3. "Profile" → `/profile/{username}`
4. "Settings" → `/app/settings`
5. Separator
6. "Sign out" → `signOut()` — `text-destructive`

