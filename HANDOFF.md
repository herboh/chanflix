# Chanflix Overhaul — Handoff Manifest

Session date: 2026-07-08 → 09. Integration branch: `dev`. Detailed running log: `CHANFLIX_STATUS.md`.

## Initial Goals (owner's brief)

1. **Ops/Now overhaul** — treat this as an overhaul of the Operations tab, with a great home-page "Now" panel that mirrors ops info at summary scale: live Plex streams via Tautulli, active downloads and ones finished in the last ~5 minutes with movie posters.
2. **Home page scale fixes** — Popular This Month and Recent Activity rows are too big; Recent Activity should scroll with timestamps always visible; shrink/remove review + message board widgets to make room for the Now panel.
3. **Operations absorbs Downloads** — downloads become part of Operations; better direct Radarr/Sonarr interaction, at minimum a "retry" button (= magnifying-glass search on demand), maybe interactive search later.
4. **Library classification** — items that exist on Radarr/Sonarr but aren't downloaded/downloading should not spin as "processing" forever; label them properly and give them the retry button.
5. **Request tagging** — fix the old bug where per-user tags broke requesting entirely; each user's requests should carry a `request-<id>-<name>` tag in Radarr/Sonarr.
6. **Quality triggers** — dead-simple per-user quality trigger plumbing + UX only; implementation details later.
7. **Design overhaul** — own test branch; "hackery-square old school look with modern JS niceties"; explicitly NOT rounded-purple-2024 slop; keep character.
8. **Shelve "Open Plex"** — remove it from the sidebar/hamburger; it doesn't work.
9. **Nice-to-haves** — post-request status popup; webhook so a finished download triggers a scan and availability updates ASAP.
10. **General** — simplify, don't reinvent the wheel, keep a common status doc updated, small commits on feature branches/worktrees.

## Done (merged to `dev`)

| Commit | What |
|---|---|
| `bd39348` | Dockerfile `COMMIT_TAG` defaults to `local`; prod deploys must use `scripts/deploy-chanflix-prod.sh` (passes real SHA). |
| `da1df53` | **Request tagging fixed and fail-soft.** Root cause: tag create/read failures threw inside the TypeORM `@AfterInsert/@AfterUpdate` save hook (`sendToRadarr/sendToSonarr` rethrow), failing the whole request — that's why enabling `tagRequests` used to break requesting. Now: `resolveRequestUserTagId()` in `server/lib/requestTags.ts` reuses legacy `"4 - name"` tags, creates sanitized `request-<id>-<name>` labels, retries a re-read after failed create (races / read-only keys), and returns undefined on any failure — a tag can never block a request. 4 new unit tests; also pinned a date-bomb test in the TMDB cache suite. |
| `0c052e2` | **Quality trigger plumbing (goal 6).** Per-user `qualityTriggers` config on `user_settings` (migration smoke-tested), GET/POST `/api/v1/user/:id/settings/quality-triggers`, no-op `evaluateQualityTriggers()` hook in sendToRadarr/sendToSonarr (the single place rules land later), MANAGE_USERS-gated settings tab stub. |
| request-flow merge | **Post-request popup + download webhook (goal 9).** Request modals show a success pane (poster, approved/pending status, progress link). `POST /api/v1/webhooks/servarr`: secret-authenticated (auto-generated `main.webhookSecret`, fail-closed, constant-time), Radarr/Sonarr import events → downloadTracker refresh + 60s-debounced Plex recently-added scan. Radarr/Sonarr Connect setup steps in `CHANFLIX_DEV_SERVER.md`. |
| `cbeda03`/`1ab40ce`/`a1dbfc5` | Roadmap + progress bookkeeping in `CHANFLIX_STATUS.md`. |

Pre-session context (earlier passes, already on `dev`): external API cache TTL/retry/stale-fallback fixes, TMDB persistent metadata cache + nightly prewarm, download history persistence, Operations page v1, polling reductions, docs-route removal, and the `021aefe` stats/library visibility-leak fixes.

## Ready for review (unmerged branch)

- **`feat/design-overhaul`** — gruvbox terminal design system: warm near-black neutrals, green primary / orange secondary accents (all indigo/purple remapped away at the Tailwind theme level, so unconverted surfaces — including the new Now panel/Operations — snap onto the palette automatically), square corners, mono accents, thin square scrollbars, 120ms snappy motion. System documented in `DESIGN.md` on the branch. Rebased onto fully-merged dev; typecheck + production `build:next` re-verified after rebase.
  **Needs the owner's eyes before merge**: home/Discover widgets (incl. new Now panel), settings pages, TitleCard hover, badge/chip contrast, squared pills. Known follow-up: self-host the Google Fonts import (render-blocking).

## Also done (merged after this manifest's first draft)

- **`feat/ops-now` merged (goals 1–4, 8)** — Tautulli `get_activity` + `GET /api/v1/stats/now` (streams for all users; downloads + finished-in-5-min with posters for request managers), home Now panel (live-pulse streams, poster'd downloads, quiet empty state, 30s poll), compact Popular This Month, scrollable Recent Activity with always-visible timestamps, review/message-board widgets unplugged, `POST /api/v1/downloads/retry` → Radarr `MoviesSearch`/Sonarr `SeriesSearch` with retry buttons in Operations and Library, Downloads page folded into Operations (`/downloads` redirects), Library "Not Downloaded" (stalled, no spinner) vs "Downloading" classification, Open Plex sidebar action removed.
- **Full gate passed on merged `dev`**: 28/28 unit tests, `yarn typecheck` clean, production `yarn build` clean, all 37 migrations smoke-applied to a disposable SQLite DB (`qualityTriggers` column verified).

## Left to do

1. Owner visual review of `feat/design-overhaul`, then merge it last (styling-only; already rebased over everything).
2. Container smoke test, then deploy via `scripts/deploy-chanflix-prod.sh` (never bare compose build).
3. Post-deploy: re-enable `tagRequests` on Radarr (Sonarr already on); submit a test request; if logs show `Failed to create user tag`, the Radarr API key lacks write access to `/tag` — fix in Radarr, requests keep working untagged meanwhile. Configure the servarr webhook in Radarr/Sonarr Connect (URL/secret steps in `CHANFLIX_DEV_SERVER.md`; secret auto-generates into `config/settings.json` on first boot). Verify Now panel/Operations/Library against live Tautulli/Radarr (the `get_activity` field shapes were typed from docs) and do one manual retry against live Radarr. Watch logs for TMDB/Discord 429s and tag errors.
4. Deferred/ideas: interactive search UI (beyond retry), quality-trigger rule implementation (plumbing is stubbed at `evaluateQualityTriggers`), TMDB prewarm scope decision, self-hosted fonts, prune unused `requestSuccess` i18n strings, retry endpoint reports "triggered" even if servarr swallows the command error (needs a rethrow variant for real feedback).

## Conventions

- Small conventional commits, grouped by behavior, `Co-Authored-By: Claude` trailer.
- `CHANFLIX_STATUS.md` is the living todo/done tracker; this file is the point-in-time handoff.
- Don't commit `config/db.bak/`, `config/settings.bak`, `handoff.md` (gitignored scratch), or local deploy notes.
