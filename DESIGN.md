# Chanflix Design System

Old-school terminal aesthetic — gruvbox dark, square corners, monospace —
with modern niceties (snappy transitions, skeletons, hover states).

## Rules

- **No rounding.** `globals.css` forces `border-radius: 0 !important`
  globally; the Tailwind `borderRadius` scale is capped at 4px as backup.
  Never reintroduce pills or rounded cards.
- **No purple. No blue-gray.** The stock Tailwind palettes are remapped in
  `tailwind.config.js` — writing `bg-gray-800` or `text-indigo-400` in a
  component is fine and lands on gruvbox automatically:
  | Utility scale | Renders as | Role |
  |---|---|---|
  | `gray-*` | gruvbox neutrals (`#1d2021` → `#fbf1c7`) | page/card/borders/text |
  | `indigo-*` | gruvbox green (`#98971a` / `#b8bb26`) | primary accent |
  | `purple-*`, `orange-*` | gruvbox orange (`#d65d0e` / `#fe8019`) | secondary accent |
  | `green-*` | gruvbox aqua (`#689d6a` / `#8ec07c`) | success |
  | `red-*` | gruvbox red (`#cc241d` / `#fb4934`) | danger |
  | `yellow-*` | gruvbox yellow (`#d79921` / `#fabd2f`) | warning/pending |
  | `blue-*` | gruvbox blue (`#458588` / `#83a598`) | info/movie chips |
  | `white` | `#fbf1c7` (light0 cream) | emphasis text |
  Prefer the stock utility names in new code; reserve explicit `gruvbox-*`
  tokens for the shared component classes in `globals.css`.
- **Monospace everywhere.** `font-sans` and `font-mono` both resolve to the
  JetBrains Mono stack (Google Fonts import in `globals.css`). Labels,
  buttons, and badges are uppercase + tracking-wide.
- **Sharp borders, not shadows.** Panels are `border-2` (or 1px dividers)
  on `bg`/`bg-hard`; hover states brighten the border, they don't lift.
- **Snappy motion.** All transition durations are globally capped at 120ms.
  Don't write long floaty transitions; they'll be clamped anyway.
- **Terminal flourishes** (use sparingly): `> ` prefix on slider titles,
  `## ` on overview headings, left-border active states in the sidebar,
  subtle body scanlines, yellow `::selection`, square scrollbars.
- **Posters are the color.** UI chrome stays muted warm; let artwork pop.
  Poster hovers use the near-black gradient (`rgba(29,32,33, …)`), never
  slate.

## Contrast floors

Body text ≥ `gray-300` (`#bdae93`) on `gray-800`; `gray-500` is only for
de-emphasized metadata. Accent text on dark: use the `-bright`/400 variants.
