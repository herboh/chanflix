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
        // Remap Tailwind's stock palettes onto gruvbox so the hundreds of
        // existing `gray-*` / `indigo-*` / etc. utilities land on the
        // terminal theme instead of cool blue-gray + purple defaults.
        white: '#fbf1c7',
        gray: {
          50: '#fbf1c7',
          100: '#ebdbb2',
          200: '#d5c4a1',
          300: '#bdae93',
          400: '#a89984',
          500: '#928374',
          600: '#504945',
          700: '#3c3836',
          800: '#282828',
          900: '#1d2021',
        },
        // Primary accent: gruvbox green (replaces indigo)
        indigo: {
          50: '#f6f2c8',
          100: '#eee6a2',
          200: '#dfd77a',
          300: '#cdc94e',
          400: '#b8bb26',
          500: '#98971a',
          600: '#79740e',
          700: '#5f5a0b',
          800: '#454108',
          900: '#2c2905',
        },
        // Secondary accent: gruvbox orange (replaces purple — no purple slop)
        purple: {
          50: '#fff0e0',
          100: '#ffe3c8',
          200: '#fec996',
          300: '#fea963',
          400: '#fe8019',
          500: '#d65d0e',
          600: '#b34d0b',
          700: '#8a3c09',
          800: '#622a06',
          900: '#3d1a04',
        },
        orange: {
          50: '#fff0e0',
          100: '#ffe3c8',
          200: '#fec996',
          300: '#fea963',
          400: '#fe8019',
          500: '#d65d0e',
          600: '#b34d0b',
          700: '#8a3c09',
          800: '#622a06',
          900: '#3d1a04',
        },
        blue: {
          50: '#e8f0f0',
          100: '#d1e2e2',
          200: '#b3cfcf',
          300: '#9bc0bf',
          400: '#83a598',
          500: '#458588',
          600: '#3a7174',
          700: '#2f5c5f',
          800: '#24474a',
          900: '#193335',
        },
        // Success: gruvbox aqua (kept distinct from the olive primary)
        green: {
          50: '#ecf3ea',
          100: '#d9e7d6',
          200: '#c1d8bc',
          300: '#a8cba0',
          400: '#8ec07c',
          500: '#689d6a',
          600: '#57855a',
          700: '#466c49',
          800: '#355438',
          900: '#243b27',
        },
        red: {
          50: '#fdecea',
          100: '#fbd8d4',
          200: '#f8b0a8',
          300: '#fc7a6e',
          400: '#fb4934',
          500: '#cc241d',
          600: '#af1e18',
          700: '#8d1813',
          800: '#68120e',
          900: '#450c09',
        },
        yellow: {
          50: '#fdf6e3',
          100: '#fbedc7',
          200: '#fbde8f',
          300: '#fbcd57',
          400: '#fabd2f',
          500: '#d79921',
          600: '#b57f1a',
          700: '#8e6414',
          800: '#684a0f',
          900: '#443009',
        },
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
