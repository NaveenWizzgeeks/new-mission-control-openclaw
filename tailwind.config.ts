import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Theme colors backed by CSS vars defined in globals.css.
        // Triplets are space-separated R G B; the rgb()-with-alpha-channel
        // form lets Tailwind opacity modifiers (`bg-mc-accent/20`,
        // `text-mc-text/70`, etc.) keep working.
        'mc-bg':              'rgb(var(--mc-bg) / <alpha-value>)',
        'mc-bg-secondary':    'rgb(var(--mc-bg-secondary) / <alpha-value>)',
        'mc-bg-tertiary':     'rgb(var(--mc-bg-tertiary) / <alpha-value>)',
        'mc-border':          'rgb(var(--mc-border) / <alpha-value>)',
        'mc-text':            'rgb(var(--mc-text) / <alpha-value>)',
        'mc-text-secondary':  'rgb(var(--mc-text-secondary) / <alpha-value>)',
        'mc-accent':          'rgb(var(--mc-accent) / <alpha-value>)',
        'mc-accent-blue':     'rgb(var(--mc-accent-blue) / <alpha-value>)',
        'mc-accent-green':    'rgb(var(--mc-accent-green) / <alpha-value>)',
        'mc-accent-yellow':   'rgb(var(--mc-accent-yellow) / <alpha-value>)',
        'mc-accent-red':      'rgb(var(--mc-accent-red) / <alpha-value>)',
        'mc-accent-purple':   'rgb(var(--mc-accent-purple) / <alpha-value>)',
        'mc-accent-pink':     'rgb(var(--mc-accent-pink) / <alpha-value>)',
        'mc-accent-cyan':     'rgb(var(--mc-accent-cyan) / <alpha-value>)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
