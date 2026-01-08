// eslint-disable-next-line @typescript-eslint/no-var-requires
const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: 'jit',
  content: [
    './node_modules/react-tailwindcss-datepicker-sct/dist/index.esm.js',
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      transitionProperty: {
        'max-height': 'max-height',
        width: 'width',
      },
      fontFamily: {
        // Terminal/monospace font stack
        sans: ['"JetBrains Mono"', '"Fira Code"', '"IBM Plex Mono"', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        mono: ['"JetBrains Mono"', '"Fira Code"', '"IBM Plex Mono"', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        // Gruvbox Dark palette for terminal theme
        gruvbox: {
          bg: '#282828',
          'bg-hard': '#1d2021',
          'bg-soft': '#32302f',
          bg1: '#3c3836',
          bg2: '#504945',
          bg3: '#665c54',
          bg4: '#7c6f64',
          fg: '#ebdbb2',
          fg1: '#d5c4a1',
          fg2: '#bdae93',
          fg3: '#a89984',
          fg4: '#928374',
          red: '#cc241d',
          'red-bright': '#fb4934',
          green: '#98971a',
          'green-bright': '#b8bb26',
          yellow: '#d79921',
          'yellow-bright': '#fabd2f',
          blue: '#458588',
          'blue-bright': '#83a598',
          purple: '#b16286',
          'purple-bright': '#d3869b',
          aqua: '#689d6a',
          'aqua-bright': '#8ec07c',
          orange: '#d65d0e',
          'orange-bright': '#fe8019',
        },
      },
      borderRadius: {
        // Override rounded utilities to be more angular
        DEFAULT: '2px',
        sm: '1px',
        md: '2px',
        lg: '3px',
        xl: '4px',
      },
      typography: (theme) => ({
        DEFAULT: {
          css: {
            color: theme('colors.gruvbox.fg'),
            a: {
              color: theme('colors.gruvbox.green-bright'),
              '&:hover': {
                color: theme('colors.gruvbox.yellow-bright'),
              },
            },

            h1: {
              color: theme('colors.gruvbox.fg'),
            },
            h2: {
              color: theme('colors.gruvbox.fg'),
            },
            h3: {
              color: theme('colors.gruvbox.fg'),
            },
            h4: {
              color: theme('colors.gruvbox.fg1'),
            },
            h5: {
              color: theme('colors.gruvbox.fg1'),
            },
            h6: {
              color: theme('colors.gruvbox.fg1'),
            },

            strong: {
              color: theme('colors.gruvbox.fg'),
            },

            code: {
              color: theme('colors.gruvbox.green-bright'),
            },

            figcaption: {
              color: theme('colors.gruvbox.fg3'),
            },
          },
        },
      }),
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
  ],
};
