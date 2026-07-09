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
| `cbeda03`/`1ab40ce`/`a1dbfc5` | Roadmap + progress bookkeeping in `CHANFLIX_STATUS.md`. |

Pre-session context (earlier passes, already on `dev`): external API cache TTL/retry/stale-fallback fixes, TMDB persistent metadata cache + nightly prewarm, download history persistence, Operations page v1, polling reductions, docs-route removal, and the `021aefe` stats/library visibility-leak fixes.

## Ready for review (unmerged branch)

- **`feat/design-overhaul`** — gruvbox terminal design system: warm near-black neutrals, green primary / orange secondary accents (all indigo/purple remapped away at the Tailwind theme level, so unconverted surfaces snapped over in one move), square corners, mono accents, thin square scrollbars, 120ms snappy motion. System documented in `DESIGN.md` on the branch. Rebased onto current dev; `typecheck:client` + production `build:next` verified.
  **Needs the owner's eyes before merge**: home/Discover widgets, settings pages, TitleCard hover, badge/chip contrast, squared pills. Known follow-up: self-host the Google Fonts import (render-blocking).

## In flight (agents working on worktree branches)

- **`feat/ops-now`** (goals 1–4, 8) — committed so far: Tautulli `get_activity` integration + `GET /api/v1/stats/now` (streams / active downloads / finished-in-5-min, with posters), home Now panel + compact/scrollable home widgets. Remaining: fold Downloads page into Operations (+nav/redirect), retry-search button (route + Operations/Library UI), Library missing-vs-processing classification, remove Open Plex.
- **`feat/quality-triggers`** (goal 6) — server plumbing done (per-user settings storage, API, no-op `evaluateQualityTriggers` hook in the request pipeline); remaining: user-settings UI stub, tests, migration smoke.
- **`feat/request-flow`** (goal 9) — in progress: post-request success pane in RequestModal (poster/status/link), then inbound `POST /api/v1/webhooks/servarr` (shared secret, Radarr/Sonarr download-complete → downloadTracker refresh + debounced availability scan), docs for Radarr/Sonarr Connect setup, tests.

## Left to do

1. Review + merge `feat/ops-now`, `feat/quality-triggers`, `feat/request-flow` into `dev` (cherry-pick or merge; resolve overlaps in stats routes/OpenAPI/home widgets — ops-now wins on widget internals, design branch wins on styling).
2. Owner visual review of `feat/design-overhaul`, then merge it last (it's styling-only by design, so it should apply cleanly over the feature branches).
3. Full gate on merged `dev`: `yarn test:unit`, `yarn typecheck`, `yarn build`, `git diff --check`; migration smoke against a disposable SQLite DB (quality-triggers adds a migration).
4. Container smoke test, then deploy via `scripts/deploy-chanflix-prod.sh` (never bare compose build).
5. Post-deploy: re-enable `tagRequests` on Radarr (Sonarr already on); submit a test request; if logs show `Failed to create user tag`, the Radarr API key lacks write access to `/tag` — fix in Radarr, requests keep working untagged meanwhile. Configure the new servarr webhook in Radarr/Sonarr Connect settings. Watch logs for TMDB/Discord 429s and tag errors.
6. Worktree/branch cleanup after merges (`git worktree remove`, delete `worktree-agent-*` branches).
7. Deferred/ideas: interactive search UI (beyond retry), quality-trigger rule implementation (plumbing is stubbed at `evaluateQualityTriggers`), TMDB prewarm scope decision, self-hosted fonts.

## Conventions

- Small conventional commits, grouped by behavior, `Co-Authored-By: Claude` trailer.
- `CHANFLIX_STATUS.md` is the living todo/done tracker; this file is the point-in-time handoff.
- Don't commit `config/db.bak/`, `config/settings.bak`, `handoff.md` (gitignored scratch), or local deploy notes.
