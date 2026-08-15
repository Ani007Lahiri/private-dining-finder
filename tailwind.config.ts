import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5d9e2',
          300: '#b1b9c9',
          400: '#8792ab',
          500: '#687490',
          600: '#535d77',
          700: '#444c61',
          800: '#3b4152',
          900: '#343846',
          950: '#22252e',
        },
        // Status palette, validated with the dataviz validator in both modes:
        // CVD separation PASS (worst adjacent ΔE 11.3 protan), normal-vision
        // PASS (27.6). Yellow sits below 3:1 on the light surface by design —
        // mitigated by the icon + text label that every badge carries, so a
        // trust state is never communicated by colour alone.
        trust: {
          verified: '#0ca30c',
          likely: '#fab219',
          unverified: '#d03b3b',
        },
        // Sequential blue, single hue, for score-component magnitude meters.
        meter: {
          track: '#e1e0d9',
          fill: '#2a78d6',
          strong: '#1c5cab',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
