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
        silkscreen: ['var(--font-silkscreen)', 'monospace'],
      },
      colors: {
        /* ---- Field Scout palette (use these on reskinned surfaces) ---- */
        page: '#e4e5e8', // flat light-grey page background
        ink: { DEFAULT: '#000000', 2: '#161616' },
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
      },
      // Hard un-blurred offset shadows — the neo-brutalist signature.
      // Shadow = "liftable/pressable". No soft shadows anywhere.
      boxShadow: {
        'hard-4': '3.2px 3.2px 0 #000000',
        'hard-6': '4.8px 4.8px 0 #000000',
        'hard-8': '6.4px 6.4px 0 #000000',
        'hard-up-4': '3.2px -3.2px 0 #000000',
        'hard-up-6': '4.8px -4.8px 0 #000000',
        'hard-up-8': '6.4px -6.4px 0 #000000',
        'hard-accent': '4.8px 4.8px 0 #3d5cff',
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
        sidebar: '243px',
        'sidebar-collapsed': '67px',
        // Rail strip matches the collapsed sidebar width so both edges read
        // as the same icon rail.
        'rail-strip': '67px',
        'rail-panel': '256px',
        'card-pad': '16px',
      },
      maxWidth: {
        content: '1152px',
        // Right context column — capped at a mobile-compliant width so it
        // stacks cleanly and the main column keeps the rest.
        rail: '374px',
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
      },
      animation: {
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
