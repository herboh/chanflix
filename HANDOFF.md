# Chanflix Overhaul — Handoff Manifest

Sessions: 2026-07-08 → 09. Integration branch: `dev`. **Status: all work merged and deployed to production** (`b69c900eca3e`). Living tracker: `CHANFLIX_STATUS.md`.

## What Chanflix is

A personal fork of Overseerr (Plex request manager), heavily customized. Stack: Next.js + Express + TypeORM (SQLite) + Tailwind. Integrations: Plex, Tautulli, Radarr/Sonarr, TMDB, Discord. Deploy via `scripts/deploy-chanflix-prod.sh`.

## Goals (owner's brief)

1. Operations overhaul + a home "Now" panel mirroring it (live streams, active/just-finished downloads with posters).
2. Home scale fixes — compact Popular This Month + scrollable Recent Activity with visible timestamps; make room for the Now panel.
3. Operations absorbs Downloads; direct Radarr/Sonarr interaction (at least a retry/search button).
4. Library: classify "on Radarr but not downloaded" instead of spinning forever; retry button.
5. Fix per-user request tagging (the old bug that broke requesting); each request tags Radarr/Sonarr by user.
6. Dead-simple per-user quality-trigger plumbing + UX (details later).
7. Design overhaul — square/old-school hacker aesthetic, no rounded-purple slop; own branch.
8. Shelve the broken "Open Plex" action.
9. Nice-to-haves — post-request status popup; download-finished webhook → availability scan.
10. General — simplify, keep a common status doc, small commits on feature branches.

## Done — shipped & live

Every goal above is delivered, merged to `dev`, and deployed. Key commits:

| Area | Commit | Notes |
|---|---|---|
| Dockerfile / deploy path | `bd39348` | `COMMIT_TAG` defaults to `local`; prod uses the deploy script (real SHA). |
| Request tagging (goal 5) | `da1df53` | Fail-soft; root cause was tag errors rethrown inside the TypeORM save hook. Legacy tags reused, create races retried. Safe to enable `tagRequests`. |
| Ops/Now + Library + nav (goals 1–4, 8) | `affaeef` | `get_activity`, `/stats/now`, Now panel, compact/scrollable widgets, `/downloads/retry`, retry buttons, Downloads→Operations, Library stalled-vs-processing, Open Plex removed. |
| Request flow (goal 9) | request-flow merge | Post-request success pane; secret-authed `POST /api/v1/webhooks/servarr` → downloadTracker refresh + 60s-debounced Plex scan. |
| Quality triggers (goal 6) | `0c052e2` | Per-user `qualityTriggers` column + migration, GET/POST route, no-op `evaluateQualityTriggers()` hook, gated settings-tab stub. |
| Design overhaul (goal 7) | `da30a46` | Gruvbox terminal theme, remapped at the Tailwind level (no purple/indigo left). See `DESIGN.md`. |
| Polish pass | `cedf667` | New "prompt + play" logo + favicons; simple skeleton card; clean download titles + posters via `server/lib/downloadEnrichment.ts`; multi-episode rows collapsed to one "Season N · X eps" row with exact-time tooltips; Operations activity de-duplicated. |

Verified live post-deploy: new logo served (no purple), and the Star Trek downloads that were 8+ raw-named rows now render as one clean "Star Trek: The Next Generation — Season 1 · 10 eps" row with a poster.

Gates throughout: `yarn test:unit` (29 tests), `yarn typecheck`, `yarn build`, migration smoke on a disposable SQLite DB.

## Left to do

1. **Fix the poster-load 429s (the one real bug).** App-level `express-rate-limit` throttles the burst of per-card `/api/v1/movie/{id}` + `/request/{id}` calls a grid fires on mount, so some cards load blank. Raise/scope the limiter for authenticated GETs and/or batch-dedupe card fetches. Detail in `CHANFLIX_STATUS.md` + memory `chanflix-poster-429-rootcause`.
2. **Post-deploy config (Radarr/Sonarr side, not code):** turn on Radarr `tagRequests`; add the servarr webhook in Radarr/Sonarr Connect (secret in `config/settings.json`, steps in `CHANFLIX_DEV_SERVER.md`).
3. **Deferred ideas:** interactive search UI; real quality-trigger rules at `evaluateQualityTriggers`; retry endpoint should surface real servarr failures; self-host fonts; prune unused i18n strings; TMDB prewarm scope.

## Conventions

- `CHANFLIX_STATUS.md` = living todo/done tracker; this file = point-in-time handoff.
- Small conventional commits; gate before merge; deploy only via the script.
