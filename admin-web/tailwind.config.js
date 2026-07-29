/** @type {import('tailwindcss').Config} */

// Daprova's design tokens. The same hex values exist as CSS custom properties
// in src/index.css for the hand-written landing-page stylesheet — keep the two
// in sync. They're literals rather than var() references here so Tailwind's
// opacity modifiers (bg-ink/50) keep working.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#12212e', soft: '#4a5a63' },
        ground: '#f1f4f2',
        paper: '#ffffff',
        gain: { DEFAULT: '#0e7c5a', deep: '#0a5d43', wash: '#e6f1ec' },
        sage: '#5f736d',
        rule: '#d7ded9',
        amber: { DEFAULT: '#946515', wash: '#fbf3e3' },
        flag: { DEFAULT: '#b4463a', wash: '#fbeceb' },
      },
      fontFamily: {
        // Condensed for headings, sans for prose, mono for every figure — this
        // is a measurement product, so numbers get tabular treatment.
        display: ['"IBM Plex Sans Condensed"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      // Near-square corners throughout: this reads as an instrument, and
      // pill-shaped chrome undercuts that.
      borderRadius: {
        DEFAULT: '2px',
        sm: '2px',
        md: '2px',
        lg: '3px',
        xl: '3px',
      },
    },
  },
  plugins: [],
};
