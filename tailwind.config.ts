import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

// FieldScout v7 theme (Claude Design "FieldScout Next v7", ruled 2026-10-12).
// Values are v7's literal numbers — the old ×0.8 pre-scaling is retired.
// Token NAMES are kept from the previous system and retargeted in place, so
// every screen picks up the v7 look; screens are then re-laid-out one by one.
// Single theme: palette is literal hex here; the HSL-triplet vars in
// globals.css are the shadcn compatibility layer.
/**
 * Layout mode (Chris, 2026-10-13). Inside the app, `<html data-layout>` is
 * `desktop` for a mouse/trackpad device and `mobile` for touch devices (or
 * when a desktop user switches to the mobile layout in a very narrow window)
 * — set by `src/hooks/use-layout-mode.ts` and its head script.
 *
 * - `sm` / `md` / `lg`: the width media query OR desktop mode, so the desktop
 *   layout holds at any window width (the shell's `min-w-app` makes the window
 *   cover the app instead). Outside the app (landing, auth) there is no
 *   attribute and these are plain width breakpoints.
 * - `xl` / `2xl`: width only — they refine the desktop layout on big screens.
 * - `max-sm` / `max-md`: width AND not desktop mode.
 * - `desk`: desktop mode only — the app frame's switch (sidebar, top bar,
 *   right-side bar vs bottom tabs). `mob`: mobile mode only.
 *
 * `:where()` keeps specificity at a single class, so source order (sm < md <
 * lg < xl < 2xl) decides overlaps exactly as Tailwind's own screens do.
 */
const DESKTOP = ':where(html[data-layout="desktop"]) &'
const NOT_DESKTOP = ':where(html:not([data-layout="desktop"])) &'
function layoutModeVariants({ addVariant }: { addVariant: (name: string, def: string | string[]) => void }) {
  addVariant('max-sm', `@media not all and (min-width: 640px) { ${NOT_DESKTOP} }`)
  addVariant('max-md', `@media not all and (min-width: 768px) { ${NOT_DESKTOP} }`)
  addVariant('sm', ['@media (min-width: 640px)', DESKTOP])
  addVariant('md', ['@media (min-width: 768px)', DESKTOP])
  addVariant('lg', ['@media (min-width: 1024px)', DESKTOP])
  addVariant('xl', '@media (min-width: 1280px)')
  addVariant('2xl', '@media (min-width: 1536px)')
  addVariant('desk', DESKTOP)
  addVariant('mob', ':where(html[data-layout="mobile"]) &')
}

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // Breakpoints are registered by the `layoutModeVariants` plugin below, not
    // here: inside the app a mouse/trackpad device keeps sm/md/lg ON at any
    // window width (the desktop layout locks at its 1024px minimum instead of
    // degrading). Leaving this empty stops Tailwind's own screen variants from
    // shadowing the plugin's.
    screens: {},
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // Wordmark/logo lockup only — never body text.
        wordmark: ['var(--font-silkscreen)', 'monospace'],
        // FieldScout Landing v13 look (ruled the new app look, 2026-10-02).
        inter: ['var(--font-inter)', '-apple-system', 'system-ui', 'sans-serif'],
        silkscreen: ['var(--font-silkscreen)', 'monospace'],
      },
      colors: {
        /* ---- FieldScout palette — v7 values ---- */
        page: '#FFFFFF', // v7 page is white; sunken fills use n-5 / muted
        ink: { DEFAULT: '#1D1D1F', 2: '#3A3A3C' },
        // Grey ramp: 1 ink, 2 strong secondary, 3 secondary text, 4 hairline,
        // 5 sunken fill, 6 tertiary text (v7's most-used grey).
        n: { 1: '#1D1D1F', 2: '#3A3A3C', 3: '#6E6E73', 4: '#EBEBEE', 5: '#F5F5F7', 6: '#8E8E93', 7: '#C7C7CC', 8: '#AEAEB2' },
        // v7 control fills, lightest to darkest: sunken panels, resting
        // secondary/segment track, quiet hover, secondary hover / switch off,
        // switch-off hover.
        surface: {
          sunken: '#F5F5F7',
          control: '#F2F2F4',
          hover: '#EDEDF0',
          pressed: '#E5E5EA',
          strong: '#D8D8DD',
          selected: '#E8E8ED', // v7 active nav row
        },
        // v7 blue — "do a thing": buttons, tabs, selection, links, AI.
        accent: {
          DEFAULT: '#0088FF',
          strong: '#0074DB',
          soft: '#EAF4FF',
          deep: '#0060B8', // text on accent-soft (selected chips)
          foreground: '#ffffff',
        },
        // v7 green — "look here": live dots, the logo tile. Never controls.
        brand: {
          DEFAULT: '#07D066',
          hover: '#05BD5C',
          strong: '#07A852',
          soft: '#E6F9EE',
          foreground: '#1D1D1F',
        },
        // Reserved football semantics: only up/down/caution — never identity.
        // DEFAULT = tinted fill (ink text), soft = wash, strong = text/icon.
        positive: { DEFAULT: '#C8F2D9', soft: '#EAF9F0', strong: '#07A852' },
        // Error / down / destructive (Chris, 2026-10-18 — "That red is for
        // text and small icons not backgrounds"; CLAUDE.md → "Bright red is
        // ink, never paint"):
        // - strong = THE BRIGHT RED. Text and small icons ONLY — an error's
        //   words, its alert glyph, a destructive label, and tiny indicators
        //   (live dot, "needs you" dot, count badge). NEVER a surface fill:
        //   no toast, banner, button, chip/pill with text, row, sheet or clock
        //   is `bg-negative-strong`. Pinned by ui/system-message-rule.test.ts.
        // - soft = the background-safe error surface (inline notices, refusal
        //   boxes, destructive hover washes) under `text-negative-strong`.
        // - DEFAULT = the stronger background-safe tint (ink text).
        // The phone's equivalents switch for its dark mode: `m-gr` (tint) and
        // `m-tr` (red text) below.
        negative: { DEFAULT: '#FFD3D9', soft: '#FFF0F2', strong: '#FF0028' },
        caution: { DEFAULT: '#FFE58A', soft: '#FFF6D6', strong: '#E07B00' },
        // v7 button fills: confirm (start / accept) and warning.
        confirm: { DEFAULT: '#07B85A', hover: '#06A651' },
        warn: { DEFAULT: '#FF8A00', hover: '#F27A00' },
        // OPRK pills (D497, Chris 2026-10-05): soft tint + very dark text of the
        // same hue, no border. hard = 1–10 (red), mid = 11–22 (orange),
        // easy = 23–32 (green). Only `oprkPillClass` (my-team-ops.ts) uses them.
        oprk: {
          hard: { DEFAULT: '#fde2df', fg: '#7a1a12' },
          mid: { DEFAULT: '#ffe4c7', fg: '#7a3500' },
          easy: { DEFAULT: '#d9f4e1', fg: '#14532d' },
        },
        // Locked-player indicator (D497): light yellow fill, dark yellow-brown glyph.
        lock: { DEFAULT: '#fff3b8', fg: '#5c4300' },
        // Position identity (v7). White text, except K and DEF/DST which are
        // light fills and take ink text (`pos-text-dark`). IDP keeps a grey.
        // `-tint` = v7 Draft Room's pale board-cell fill for each position.
        pos: {
          qb: { DEFAULT: '#F75252', tint: '#FDE4E4' },
          rb: { DEFAULT: '#5C7CE5', tint: '#E3E9FB' },
          wr: { DEFAULT: '#9D70E9', tint: '#EEE6FC' },
          te: { DEFAULT: '#ECAD48', tint: '#FBF0DC' },
          flex: { DEFAULT: '#00A3A0', tint: '#DDF3F2' },
          k: { DEFAULT: '#D2E8E8', tint: '#E9F4F4' },
          def: { DEFAULT: '#FFE75E', tint: '#FFF8CF' },
          idp: '#8E8E93',
          text: '#ffffff',
          'text-dark': '#1D1D1F',
        },
        // Tier ramp, 1 = best. Tiers 3–4 take dark text, the rest white.
        // 1, 2, 5 and 6 are darker shades of the original hues (same OKLCH
        // hue + chroma, lower lightness) so their white chip text passes WCAG
        // AA 4.5:1 (Chris, 2026-10-15; were #d64a95 / #df5551 / #3fa055 /
        // #1f9aa6 at ~4.0 / 3.8 / 3.3 / 3.4:1). Pinned by
        // `lists/bucket-colors.test.ts` — every step's fill/text pair ≥ 4.5.
        tier: {
          1: '#c93e8a',
          2: '#ce4543',
          3: '#e58033',
          4: '#e6b422',
          5: '#1f863c',
          6: '#00818d',
          7: '#4a63c4',
          // Legacy S–F keys — still referenced by pre-reskin screens; remove in phase 7.
          s: '#FFD700',
          a: '#1DB954',
          b: '#3B82F6',
          c: '#EAB308',
          d: '#F97316',
          f: '#E5534B',
        },
        // White-on-ink steps for the dark chrome (sidebar, rail). DEFAULT =
        // resting text/icons, muted = section labels/roles/kbd text, wash =
        // hover fill + crest tile fill, rule = divider lines, border = crest
        // + kbd borders. One-off steps (20/40/60/80) stay as literal `white/NN`.
        'on-ink': {
          DEFAULT: 'rgb(255 255 255 / 0.75)',
          muted: 'rgb(255 255 255 / 0.5)',
          wash: 'rgb(255 255 255 / 0.1)',
          rule: 'rgb(255 255 255 / 0.1)',
          border: 'rgb(255 255 255 / 0.25)',
        },

        /* ---- FieldScout v13 look (Claude Design "FieldScout Landing v13";
           ruled the new app look 2026-10-02). Landing page first; the rest
           of the app moves over later. Use only on v13 surfaces. ---- */
        fs: {
          page: '#F5F5F7', // page + sunken fills (inputs, chips, inset panels)
          raised: '#FBFBFD', // window/card title bars, table heads
          ink: { DEFAULT: '#1D1D1F', 2: '#2C2C2E', 3: '#3A3A3C' },
          text: { 2: '#424245', 3: '#6E6E73', 4: '#86868B', 5: '#AEAEB2' },
          'on-ink': { 2: '#A1A1A6', 3: '#D2D2D7' }, // secondary text on ink cards
          line: { DEFAULT: '#F0F0F2', strong: '#E5E5EA', field: '#DCDCDF' },
          fill: { DEFAULT: '#E5E5EA', strong: '#D2D2D7', off: '#C7C7CC' },
          blue: {
            DEFAULT: '#0080FF',
            hover: '#006FDE',
            deep: '#0060C0',
            soft: '#E8F2FF',
            tint: '#EEF6FF',
            wash: '#F5F9FF',
          },
          green: '#00D167',
          caution: '#FFE58A',
          violet: { DEFAULT: '#5B2FD1', soft: '#F0EBFF', wash: '#FBFAFF', scout: '#A970FF' },
        },

        /* ---- Mobile theme (FieldScout Mobile handoff). CSS-variable backed so
           the mobile layout can switch light/dark — globals.css. Use only in
           mobile components. ---- */
        m: {
          't1': 'rgb(var(--m-t1) / <alpha-value>)',
          't2': 'rgb(var(--m-t2) / <alpha-value>)',
          't3': 'rgb(var(--m-t3) / <alpha-value>)',
          't4': 'rgb(var(--m-t4) / <alpha-value>)',
          't5': 'rgb(var(--m-t5) / <alpha-value>)',
          'b0': 'rgb(var(--m-b0) / <alpha-value>)',
          'b1': 'rgb(var(--m-b1) / <alpha-value>)',
          'b2': 'rgb(var(--m-b2) / <alpha-value>)',
          'b2h': 'rgb(var(--m-b2h) / <alpha-value>)',
          'b3': 'rgb(var(--m-b3) / <alpha-value>)',
          'b3s': 'rgb(var(--m-b3s) / <alpha-value>)',
          'b4': 'rgb(var(--m-b4) / <alpha-value>)',
          'b4m': 'rgb(var(--m-b4m) / <alpha-value>)',
          'b4l': 'rgb(var(--m-b4l) / <alpha-value>)',
          'ink': 'rgb(var(--m-ink) / <alpha-value>)',
          'bar': 'rgb(var(--m-bar) / <alpha-value>)',
          'mini': 'rgb(var(--m-mini) / <alpha-value>)',
          'gg': 'rgb(var(--m-gg) / <alpha-value>)',
          'tg': 'rgb(var(--m-tg) / <alpha-value>)',
          // The phone's error pair (light + dark, globals.css): `gr` is the
          // background-safe error tint (refusal boxes, destructive buttons,
          // red chips), `tr` the red text/icon that sits on it. The bright
          // `negative-strong` is never a phone surface fill either.
          'gr': 'rgb(var(--m-gr) / <alpha-value>)',
          'tr': 'rgb(var(--m-tr) / <alpha-value>)',
          'gb': 'rgb(var(--m-gb) / <alpha-value>)',
          'tb': 'rgb(var(--m-tb) / <alpha-value>)',
          'go': 'rgb(var(--m-go) / <alpha-value>)',
          'to': 'rgb(var(--m-to) / <alpha-value>)',
          'gb2': 'rgb(var(--m-gb2) / <alpha-value>)',
          'gp': 'rgb(var(--m-gp) / <alpha-value>)',
          dock: 'var(--m-dock)',
          // Inactive switcher dots — the same in both themes (handoff §2.2).
          dot: '#636366',
          // Fixed (non-theme) colours from the mobile handoff:
          gold: '#C98A1F', // waiver / claim actions, TE text
          median: '#FFF6E5', // league-median card
          'head-bg': '#EEEEF1', // headshot initials fallback
          // Position colours as TEXT on a light surface (README table).
          'pos-qb': '#E03E3E',
          'pos-rb': '#4A68D4',
          'pos-wr': '#8656D8',
          'pos-te': '#C98A1F',
          'pos-k': '#5E8C8C',
          'pos-dst': '#A68A00',
          // Manager avatar colours not already in the palette.
          'av-teal': '#00A6A3',
          'av-pink': '#E5508A',
          'bar-a': 'var(--m-bar-a)',
        },

        /* ---- Legacy shadcn compatibility layer (HSL vars in globals.css) ---- */
        border: 'hsl(var(--border))',
        'border-subtle': 'hsl(var(--border-subtle))',
        'ai-glint': 'hsl(var(--ai-glint) / <alpha-value>)',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        'bg-elevated': 'hsl(var(--bg-elevated))',
        'bg-elevated-2': 'hsl(var(--bg-elevated-2))',
        'bg-elevated-3': 'hsl(var(--bg-elevated-3))',
        'text-secondary': 'hsl(var(--text-secondary))',
        'text-tertiary': 'hsl(var(--text-tertiary))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: 'hsl(var(--primary-hover))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        // The bright red again (= negative-strong): `text-destructive` only.
        // No surface is `bg-destructive` — see `negative` above.
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      // `border-ink` was the previous system's "1px ink edge that separates a
      // surface from the page" (334 call sites). v7 makes the same decision
      // with a light hairline, so the border-only colour is retargeted here;
      // `text-ink` / `bg-ink` stay near-black. Screens drop `border-ink` for
      // plain `border` as they're re-laid-out.
      borderColor: {
        ink: '#EBEBEE',
      },
      // v7 soft geometry: position tags 4, chips 6, controls 8, menus 10,
      // cards 12, panels 14, big surfaces 18. Buttons are pills.
      borderRadius: {
        none: '0',
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '14px',
        '3xl': '18px',
        // Every system message — toast, banner, inline notice/alert, refusal
        // box — is a rounded RECTANGLE at this radius, desktop and phone,
        // however short it is (Chris, 2026-10-18: "we don't want the ends of
        // a system message … being rounded on the ends"). Never `rounded-pill`
        // / `rounded-full` for a message; buttons and chips inside one stay
        // pills. Pinned by ui/system-message-rule.test.ts.
        message: '12px',
        pill: '999px',
        // v13 look — soft rounded geometry (see colors.fs).
        'fs-xs': '5px', // position tags
        'fs-sm': '9px', // nav rows, segmented controls
        'fs-md': '13px', // inputs, list rows, popovers
        'fs-lg': '18px', // inner cards
        'fs-xl': '25px', // feature cards, demo windows
      },
      // v7 soft shadows. The `hard-*` NAMES are kept from the previous
      // system (113 call sites) and now resolve to v7's soft lifts; rename
      // when the last brutal screen is reskinned.
      //
      // ELEVATION IS A HOVER/PRESS AFFORDANCE, NEVER A RESTING STATE.
      // Reach for these only behind `hover:` (or a genuine active-interaction
      // state such as `isDragging`). The single exception is a true overlay —
      // dialog, popover, dropdown, select, toast, drag ghost, floating window
      // — which really does sit above the page and so carries its shadow at
      // rest. Everything in normal page flow rests flat.
      // See CLAUDE.md → "Elevation" and docs/design/lists/README.md §Geometry.
      boxShadow: {
        'hard-4': '0 0 0 1px rgba(0,0,0,.06), 0 4px 12px -4px rgba(0,0,0,.16)',
        'hard-6': '0 0 0 1px rgba(0,0,0,.06), 0 9px 24px -12px rgba(0,0,0,.22)',
        'hard-8': '0 0 0 1px rgba(0,0,0,.06), 0 15px 34px -9px rgba(0,0,0,.22)',
        'hard-up-4': '0 0 0 1px rgba(0,0,0,.06), 0 -4px 12px -4px rgba(0,0,0,.16)',
        'hard-up-6': '0 0 0 1px rgba(0,0,0,.06), 0 -9px 24px -12px rgba(0,0,0,.22)',
        'hard-up-8': '0 0 0 1px rgba(0,0,0,.06), 0 -15px 34px -9px rgba(0,0,0,.22)',
        // Ink fills take a blue-tinted lift.
        'hard-accent-4': '0 0 0 1px rgba(0,136,255,.25), 0 4px 12px -4px rgba(0,136,255,.35)',
        'hard-accent': '0 0 0 1px rgba(0,136,255,.25), 0 9px 24px -12px rgba(0,136,255,.45)',
        // v13 look — soft depth (supersedes the hard-shadow rule on v13
        // surfaces only; ruled 2026-10-02). `fs-ring` is the resting
        // hairline, `fs-float` the big demo windows, `fs-pop` menus.
        'fs-ring': '0 0 0 1px rgba(0,0,0,.06)',
        'fs-float': '0 0 0 1px rgba(0,0,0,.06), 0 40px 100px -24px rgba(0,0,0,.2)',
        'fs-pop': '0 0 0 1px rgba(0,0,0,.08), 0 16px 40px -8px rgba(0,0,0,.25)',
        'fs-seg': '0 1px 3px rgba(0,0,0,.14)',
        'fs-inset': '0 0 0 1px #F0F0F2', // inner panels inside a demo window
        // v7 control-form shadows — part of the control's shape, not
        // elevation: the selected segment pill and the switch knob.
        seg: '0 1px 3px rgba(0,0,0,.12)',
        knob: '0 1px 3px rgba(0,0,0,.2)',
        // v7 focus ring for fields (search, inputs).
        field: '0 0 0 1px #0088FF, 0 0 0 3px rgba(0,136,255,.16)',
        // v7 1px inset rings: selected chips (blue / green / pink) and the
        // resting / hovered checkbox & radio outline.
        'ring-accent': 'inset 0 0 0 1px #0088FF',
        'ring-positive': 'inset 0 0 0 1px #07A852',
        'ring-negative': 'inset 0 0 0 1px #FF0028',
        'ring-control': 'inset 0 0 0 1px #C7C7CC',
        'ring-control-hover': 'inset 0 0 0 1px #AEAEB2',
        'ring-chip': 'inset 0 0 0 1px #E5E5EA', // league switcher chip
        'avatar-hover': '0 0 0 3px #E5E5EA', // top-bar avatar hover halo
        // Mobile: active Profile tab avatar (2px ink band, then a 1.5px page
        // ring — handoff §2.3) and the header badge's page-coloured ring.
        'm-tab-avatar': '0 0 0 2px rgb(var(--m-ink)), 0 0 0 3.5px rgb(var(--m-b0))',
        'm-badge': '0 0 0 2px rgb(var(--m-b0))',
        // Mobile segmented "on" pill (README: 0 1px 2px; some screens 3px).
        'm-seg': '0 1px 2px rgba(0,0,0,.12)',
        'm-seg-3': '0 1px 3px rgba(0,0,0,.12)',
        // Mobile selection ring and outlined card (README "Shadows").
        'm-select': 'inset 0 0 0 2px #0088FF',
        'm-outline': 'inset 0 0 0 1px rgb(var(--m-b3))',
        // Mobile menus / popovers (README).
        'm-menu': '0 10px 30px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.05)',
        // Mobile centred tip card (Players column tip) and switch knob.
        'm-tip': '0 12px 32px rgba(0,0,0,.2)',
        'm-knob': '0 1px 2px rgba(0,0,0,.2)',
      },
      // v7's heaviest weight is 700: the old extra-heavy weights resolve to
      // bold, so pre-v7 `font-extrabold` / `font-black` read as v7 bold.
      fontWeight: {
        extrabold: '700',
        black: '700',
      },
      // v7 type scale (literal px). h1 greeting/display, h2 player & team
      // heroes, h3 page titles, h4 section titles, h5 card headlines, h6
      // block labels ("Needs your attention"). body/meta/micro are the
      // dense-UI sizes v7 uses everywhere else.
      fontSize: {
        h1: ['31px', { lineHeight: '33px', letterSpacing: '-0.035em', fontWeight: '700' }],
        h2: ['26px', { lineHeight: '29px', letterSpacing: '-0.035em', fontWeight: '700' }],
        h3: ['24px', { lineHeight: '28px', letterSpacing: '-0.03em', fontWeight: '700' }],
        h4: ['20px', { lineHeight: '24px', letterSpacing: '-0.03em', fontWeight: '700' }],
        h5: ['17px', { lineHeight: '21px', letterSpacing: '-0.02em', fontWeight: '700' }],
        h6: ['15px', { lineHeight: '19px', letterSpacing: '-0.02em', fontWeight: '700' }],
        body: ['11px', { lineHeight: '16px' }],
        meta: ['10px', { lineHeight: '14px' }],
        micro: ['9px', { lineHeight: '12px' }],
      },
      // Fixed control constants (v7 literal sizes).
      // Use as h-btn, h-input, w-sidebar, max-w-content, etc.
      spacing: {
        btn: '34px', // FSButton7 lg
        'btn-md': '27px', // FSButton7 md
        'btn-sm': '24px', // FSButton7 sm
        input: '29px',
        chip: '20px', // FSSegmented7 sm
        tab: '22px', // FSSegmented7 md
        header: '48px', // v7 top bar
        // Draft-room command bar (spec §16.4 zone 1; DR.2). 54px is LITERAL,
        // not a 1× handoff value to ×0.8 — Chris gave it against the running
        // app (tasks-DR C47), and it sits beside the 58px `header` token.
        'draft-topbar': '54px',
        // Draft-room status strip under the command bar (D149) — kept at the
        // pre-v7 header height until the draft room is redesigned.
        'draft-status': '58px',
        // Draft-room dock open-panel heights (spec §16.4 dock; DR.5, D151:
        // the open panel occupies a FIXED viewport fraction and overlays the
        // board — the board never resizes). Mobile opens taller because the
        // board behind it is a ticker, not a grid (§16.4 mobile specifics);
        // the desktop cap keeps 60vh from becoming a wall on tall monitors.
        'dock-panel': 'min(60vh, 640px)',
        'dock-panel-mobile': '75vh',
        sidebar: '156px', // v7 left rail, expanded
        'sidebar-collapsed': '41px', // v7 left rail, minimised
        // Rail strip matches the collapsed sidebar width so both edges read
        // as the same icon rail.
        'rail-strip': '41px',
        'rail-panel': '256px',
        // Strip + open panel: the page pads by both while a tool is open
        // (prototype ResearchRail — the panel never covers content; D483).
        'rail-open': '297px',
        'card-pad': '16px',
        // Shell-chrome constants shared across sidebar / rail / top bar.
        // A token is shared between components only when they're the same
        // design decision, not merely the same pixel number.
        'count-chip': '14px', // unseen-count pill height + min-width
        'nav-tile': '31px', // v7 nav rows (FSNavItem7 item), More-sheet rows
        'chrome-band': '37px', // rail panel head, draft bar
        'crest-row': '36px', // v7 league rows (FSNavItem7 league), Teams panel rows
      },
      maxWidth: {
        content: '1152px',
        // Right context column — capped at a mobile-compliant width so it
        // stacks cleanly and the main column keeps the rest.
        rail: '374px',
      },
      // Tailwind v3's `minWidth` scale does NOT inherit from `spacing`, so
      // the count-chip constant needs its own entry to generate min-w-count-chip.
      minWidth: {
        // Desktop app minimum: below it the window covers the app rather than
        // the layout degrading (layout-mode, Chris 2026-10-13).
        app: '1024px',
        'count-chip': '14px',
      },
      // v7 hairlines: 1px in the light --border grey.
      borderWidth: {
        DEFAULT: '1px',
        '0': '0',
        '1': '1px',
        '2': '2px',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
      transitionTimingFunction: {
        // Motion is linear, 200ms, functional only — no bounce, no flourish.
        DEFAULT: 'linear',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        // Legacy AI glint (remove in phase 7 with the AI-surface reskin).
        'border-shine': {
          '0%': { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: '0' },
          '12%': { opacity: '1' },
          '85%': { opacity: '1' },
          '100%': { transform: 'translate(-50%, -50%) rotate(360deg)', opacity: '0' },
        },
        // v13 Scout AI "alive" dot — hue cycle + pulse ring.
        'fs-scout-hue': {
          '0%, 100%': { backgroundColor: '#00C8FF', color: '#00C8FF' },
          '25%': { backgroundColor: '#A970FF', color: '#A970FF' },
          '50%': { backgroundColor: '#FF4FD8', color: '#FF4FD8' },
          '75%': { backgroundColor: '#FFB800', color: '#FFB800' },
        },
        'fs-scout-ring': {
          '0%': { boxShadow: '0 0 0 0 currentColor, 0 0 6px 1px currentColor' },
          '100%': { boxShadow: '0 0 0 8px transparent, 0 0 6px 1px currentColor' },
        },
        'fs-blink': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.2' } },
        'fs-ticker': {
          from: { transform: 'translateX(var(--fs-ticker-from, 100vw))' },
          to: { transform: 'translateX(-100%)' },
        },
      },
      animation: {
        'fs-scout': 'fs-scout-hue 6s linear infinite, fs-scout-ring 2s linear infinite',
        'fs-scout-hue': 'fs-scout-hue 6s linear infinite',
        'fs-blink': 'fs-blink 1s linear infinite',
        // Duration is set per run (it scales with the item count).
        'fs-ticker': 'fs-ticker 60s linear forwards',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 150ms linear',
        'border-shine': 'border-shine 3s cubic-bezier(0.65, 0, 0.35, 1) 0.8s 2',
      },
    },
  },
  plugins: [layoutModeVariants, tailwindcssAnimate],
}

export default config
