import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

// Field Scout neo-brutalist theme. Values from the redesign package tokens,
// pre-scaled ×0.8 (the prototype renders at 0.8 zoom — we match the painted
// result). Single theme: palette is literal hex here; the HSL-triplet vars in
// globals.css exist only as the legacy shadcn compatibility layer.
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
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
        /* ---- Field Scout palette (use these on reskinned surfaces) ---- */
        page: '#e4e5e8', // flat light-grey page background
        ink: { DEFAULT: '#0B0C10', 2: '#161616' },
        n: { 1: '#000000', 2: '#161616', 3: '#5f646d', 4: '#e7e8e9' },
        // Ultramarine — "do a thing": buttons, tabs, selection, links, AI.
        accent: {
          DEFAULT: '#3d5cff',
          strong: '#2a44e0',
          soft: '#dce4ff',
          foreground: '#ffffff',
        },
        // Lime — "look here": live signals, alerts, callouts. Never controls.
        brand: {
          DEFAULT: '#b4ff89',
          strong: '#5da62f',
          soft: '#e9ffd9',
          foreground: '#000000',
        },
        // Reserved football semantics: only up/down/caution — never identity.
        positive: { DEFAULT: '#98e9ab', soft: '#eafbee', strong: '#2e9c56' },
        negative: { DEFAULT: '#e99898', soft: '#fbeaea', strong: '#c0392b' },
        caution: { DEFAULT: '#fae8a4', soft: '#fefaed', strong: '#b98900' },
        // Position identity — saturated fills, always white text.
        pos: {
          qb: '#d9591b',
          rb: '#2c6fd6',
          wr: '#7b40d4',
          te: '#0e9488',
          flex: '#c42e86',
          k: '#6e7686',
          def: '#3e4656',
          text: '#ffffff',
        },
        // Tier ramp, 1 = best. Tiers 3–4 take dark text, the rest white.
        tier: {
          1: '#d64a95',
          2: '#df5551',
          3: '#e58033',
          4: '#e6b422',
          5: '#3fa055',
          6: '#1f9aa6',
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
      // Near-square corners are the system: every rounded-* is 1px. The only
      // round things are avatars/status dots (rounded-full stays built in).
      borderRadius: {
        none: '0',
        sm: '1px',
        DEFAULT: '1px',
        md: '1px',
        lg: '1px',
        xl: '1px',
        '2xl': '1px',
        '3xl': '1px',
        pill: '999px',
        // v13 look — soft rounded geometry (see colors.fs).
        'fs-xs': '5px', // position tags
        'fs-sm': '9px', // nav rows, segmented controls
        'fs-md': '13px', // inputs, list rows, popovers
        'fs-lg': '18px', // inner cards
        'fs-xl': '25px', // feature cards, demo windows
      },
      // Hard un-blurred offset shadows — the neo-brutalist signature.
      // No soft shadows anywhere.
      //
      // ELEVATION IS A HOVER/PRESS AFFORDANCE, NEVER A RESTING STATE.
      // Reach for these only behind `hover:` (or a genuine active-interaction
      // state such as `isDragging`). The single exception is a true overlay —
      // dialog, popover, dropdown, select, toast, drag ghost, floating window
      // — which really does sit above the page and so carries its shadow at
      // rest. Everything in normal page flow rests flat.
      // See CLAUDE.md → "Elevation" and docs/design/lists/README.md §Geometry.
      boxShadow: {
        'hard-4': '3.2px 3.2px 0 #000000',
        'hard-6': '4.8px 4.8px 0 #000000',
        'hard-8': '6.4px 6.4px 0 #000000',
        'hard-up-4': '3.2px -3.2px 0 #000000',
        'hard-up-6': '4.8px -4.8px 0 #000000',
        'hard-up-8': '6.4px -6.4px 0 #000000',
        // Ink fills take an accent shadow — an ink shadow disappears into them.
        'hard-accent-4': '3.2px 3.2px 0 #3d5cff',
        'hard-accent': '4.8px 4.8px 0 #3d5cff',
        // v13 look — soft depth (supersedes the hard-shadow rule on v13
        // surfaces only; ruled 2026-10-02). `fs-ring` is the resting
        // hairline, `fs-float` the big demo windows, `fs-pop` menus.
        'fs-ring': '0 0 0 1px rgba(0,0,0,.06)',
        'fs-float': '0 0 0 1px rgba(0,0,0,.06), 0 40px 100px -24px rgba(0,0,0,.2)',
        'fs-pop': '0 0 0 1px rgba(0,0,0,.08), 0 16px 40px -8px rgba(0,0,0,.25)',
        'fs-seg': '0 1px 3px rgba(0,0,0,.14)',
        'fs-inset': '0 0 0 1px #F0F0F2', // inner panels inside a demo window
      },
      // Heading scale (pre-scaled ×0.8; weight applied by base styles).
      fontSize: {
        h1: ['48px', { lineHeight: '54px', letterSpacing: '-0.01em', fontWeight: '800' }],
        h2: ['38px', { lineHeight: '45px', letterSpacing: '-0.01em', fontWeight: '800' }],
        h3: ['29px', { lineHeight: '37px', letterSpacing: '-0.01em', fontWeight: '800' }],
        h4: ['24px', { lineHeight: '30px', letterSpacing: '-0.01em', fontWeight: '800' }],
        h5: ['19px', { lineHeight: '26px', letterSpacing: '-0.01em', fontWeight: '800' }],
        h6: ['16px', { lineHeight: '22px', letterSpacing: '-0.01em', fontWeight: '800' }],
      },
      // Fixed control constants (pre-scaled ×0.8 of the kit's tokens).
      // Use as h-btn, h-input, w-sidebar, max-w-content, etc.
      spacing: {
        btn: '42px',
        'btn-md': '29px',
        'btn-sm': '26px',
        input: '51px',
        chip: '19px',
        tab: '26px',
        header: '58px',
        // Draft-room command bar (spec §16.4 zone 1; DR.2). 54px is LITERAL,
        // not a 1× handoff value to ×0.8 — Chris gave it against the running
        // app (tasks-DR C47), and it sits beside the 58px `header` token.
        'draft-topbar': '54px',
        // Draft-room dock open-panel heights (spec §16.4 dock; DR.5, D151:
        // the open panel occupies a FIXED viewport fraction and overlays the
        // board — the board never resizes). Mobile opens taller because the
        // board behind it is a ticker, not a grid (§16.4 mobile specifics);
        // the desktop cap keeps 60vh from becoming a wall on tall monitors.
        'dock-panel': 'min(60vh, 640px)',
        'dock-panel-mobile': '75vh',
        sidebar: '243px',
        'sidebar-collapsed': '67px',
        // Rail strip matches the collapsed sidebar width so both edges read
        // as the same icon rail.
        'rail-strip': '67px',
        'rail-panel': '256px',
        'card-pad': '16px',
        // Shell-chrome constants shared across sidebar / rail / top bar.
        // A token is shared between components only when they're the same
        // design decision, not merely the same pixel number.
        'count-chip': '14px', // unseen-count pill height + min-width
        'nav-tile': '34px', // sidebar nav rows, collapsed icons, sidebar search, rail tool buttons, More-sheet rows. NOT the top search field.
        'chrome-band': '37px', // sidebar logo band, rail account zone, rail panel head, draft bar — one continuous line across the app
        'crest-row': '45px', // sidebar league rows, Teams panel rows
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
        'count-chip': '14px',
      },
      // Hairline strokes: 0.5px everywhere (buttons opt back to 1px).
      borderWidth: {
        DEFAULT: '0.5px',
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
  plugins: [tailwindcssAnimate],
}

export default config
