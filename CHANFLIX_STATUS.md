# Chanflix Stabilization Tracker

Last updated: 2026-07-09

Living todo/done tracker. Narrative + goals live in `HANDOFF.md`; full detail is in git history.

## Current state

All overhaul + polish work is merged to `dev` and **deployed to production** via
`scripts/deploy-chanflix-prod.sh` (live commit `b69c900eca3e`, verified `/api/v1/status`).

## Shipped & live

- **Ops/Now overhaul** — Tautulli `get_activity` live streams, `GET /api/v1/stats/now`, home Now panel, compact Popular / scrollable Recent Activity, Downloads folded into Operations, Radarr/Sonarr retry-search button, Library "Not Downloaded" vs "Downloading" classification, "Open Plex" removed.
- **Request tagging fix** — fail-soft; a tag failure can never block a request. (Root cause: tag errors rethrown inside the TypeORM save hook.)
- **Quality triggers** — per-user plumbing + settings-tab stub + no-op `evaluateQualityTriggers()` hook. Rules deferred.
- **Request flow** — post-request success pane; secret-authed `POST /api/v1/webhooks/servarr` → downloadTracker refresh + debounced Plex scan.
- **Design overhaul** — gruvbox terminal theme (square, warm near-black, green/orange accents, no purple). See `DESIGN.md`.
- **Polish pass** — new "prompt + play" logo + favicons; simple skeleton placeholder; clean download titles + posters via Radarr/Sonarr id (`server/lib/downloadEnrichment.ts`), multi-episode rows collapsed to one "Season N · X eps" row, exact-time tooltips; Operations activity de-duplicated.

## Open / TODO

- [ ] **Posters randomly fail to load = app-level API rate limiter (the one known bug).** Real-browser capture shows bursts of `GET /api/v1/movie/{id}` and `/api/v1/request/{id}` returning HTTP 429 (`retry-after: 1`, `x-retry-in: ~832ms`, no `cf-ray` → Express, not Cloudflare). Each TitleCard fetches its own status on mount, so a grid fans out 20–30+ concurrent calls and the limiter throttles some → cards render with no poster/status. Single/sequential requests are fine. Fix: raise/scope the `express-rate-limit` config (dep 6.7.0) to exclude authenticated `/movie/*` and `/request/*` GETs, and/or batch-dedupe TitleCard status fetches. Memory: `chanflix-poster-429-rootcause`.
- [ ] **Post-deploy config (in Radarr/Sonarr, not code):** re-enable Radarr `tagRequests` (Sonarr already on) — now safe; if logs show `Failed to create user tag`, the Radarr API key lacks write access to `/tag`. Configure the servarr download webhook in Radarr/Sonarr Connect (URL + `main.webhookSecret` from `config/settings.json`; steps in `CHANFLIX_DEV_SERVER.md`).
- [ ] **Deferred ideas:** interactive search UI (beyond retry); implement real quality-trigger rules at `evaluateQualityTriggers`; retry endpoint reports "triggered" even if servarr swallows the command error (needs a rethrow variant); self-host the Google Fonts import; prune unused `requestSuccess` i18n strings; TMDB prewarm scope (known media vs popular/discover).

## Working Rules

- `dev` is the integration branch; promote to prod only after local build/typecheck + a container smoke test.
- Small conventional commits grouped by behavior, `Co-Authored-By: Claude` trailer.
- Feature work on its own branch (worktree for parallel work); gate (`yarn test:unit` + `yarn typecheck` + `yarn build`, migration smoke if entities change) before merge.
- Don't commit local backups/scratch: `config/db.bak/`, `config/settings.bak`, `handoff.md` (gitignored), local deploy/Cloudflare notes.

## Product Decisions

- Tautulli watch history / live streams are visible to all authenticated users; download details are gated to `MANAGE_REQUESTS`.
- Completed-download history persists across restarts via the `DownloadHistory` table.
- Persistent TMDB metadata caching + nightly prewarm are in use.

## Observed Production Signals

- `chandlerfulmer@gmail.com` / HerbieHan is user ID 1 with `Permission.ADMIN`.
- Radarr `tagRequests` was OFF (safe to turn on after the fail-soft fix); Sonarr ON.
- Plex recently-added scan every 5 min; watchlist sync every 3 min.
- Production logs: `/home/chan/docker/chanflix/logs/`.

## Deploy runbook

1. `git diff --check`, `yarn test:unit`, `yarn typecheck`; migration smoke against a disposable SQLite DB if entity/migration files changed.
2. Deploy with `scripts/deploy-chanflix-prod.sh` (passes the current Git SHA as `COMMIT_TAG`; never run a bare compose build without `CHANFLIX_COMMIT_TAG`).
3. Confirm `/api/v1/status` reports the new `commitTag`; `/api/v1/downloads` 403s for non-`MANAGE_REQUESTS`; Library/Operations load as admin.
4. Watch live logs for TMDB/Discord 429s and Radarr/Sonarr tag errors.
