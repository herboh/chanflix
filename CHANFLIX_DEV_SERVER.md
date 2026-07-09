# Chanflix LAN Dev Server

This is the quick workflow for running the app from the repo while testing it
from another machine on the LAN.

## Goal

Run Chanflix on the host, bind it to the LAN, and use a disposable copy of the
production config/database so dev testing does not write to the live container
database.

Example LAN URL:

```sh
http://192.168.1.19:5556
```

## Build And Verify First

```sh
yarn install --frozen-lockfile
yarn test:unit
yarn typecheck
git diff --check
yarn build
```

## Create Disposable Dev Config

Use `/tmp` for smoke testing. Do not point the dev server directly at
`/home/chan/docker/chanflix/db/db.sqlite3`.

```sh
rm -rf /tmp/chanflix-dev-config
mkdir -p /tmp/chanflix-dev-config/db /tmp/chanflix-dev-config/logs
cp /home/chan/docker/chanflix/settings.json /tmp/chanflix-dev-config/settings.json
sqlite3 /home/chan/docker/chanflix/db/db.sqlite3 ".backup '/tmp/chanflix-dev-config/db/db.sqlite3'"
```

When running on the host instead of inside Docker, Docker service DNS names like
`radarr`, `sonarr`, and `tautulli` will not resolve. Rewrite only the disposable
settings file to use host-published ports:

```sh
jq '(.radarr[] | select(.hostname == "radarr") | .hostname) = "127.0.0.1"
  | (.sonarr[] | select(.hostname == "sonarr") | .hostname) = "127.0.0.1"
  | if .tautulli.hostname == "tautulli" then .tautulli.hostname = "127.0.0.1" else . end' \
  /tmp/chanflix-dev-config/settings.json > /tmp/chanflix-dev-config/settings.json.tmp
mv /tmp/chanflix-dev-config/settings.json.tmp /tmp/chanflix-dev-config/settings.json
```

Expected host-published service ports:

```text
Radarr:   127.0.0.1:7878
Sonarr:   127.0.0.1:8989
Tautulli: 127.0.0.1:8181
```

## Start LAN-Accessible Dev Server

Use a non-production port so it does not collide with deployed Chanflix.

```sh
HOST=0.0.0.0 PORT=5556 CONFIG_DIRECTORY=/tmp/chanflix-dev-config yarn dev
```

Then open from another LAN machine:

```text
http://192.168.1.19:5556
```

## Smoke Checks

From the host:

```sh
curl -sS http://127.0.0.1:5556/api/v1/status
curl -sS -o /tmp/chanflix-login-smoke.html -w '%{http_code} %{content_type}\n' http://127.0.0.1:5556/login
curl -sS -o /tmp/watch-users-smoke.json -w '%{http_code} %{content_type}\n' http://127.0.0.1:5556/api/v1/media/watch-users/1
```

Expected:

- `/api/v1/status` returns `200`.
- `/login` returns `200 text/html`.
- `/api/v1/media/watch-users/1` returns `401` when unauthenticated, confirming
  the route exists and is protected.

## Watch Logs

Dev server logs are printed in the `yarn dev` terminal.

Live production logs can be tailed separately:

```sh
docker logs -f --tail 120 chanflix
```

During smoke testing, watch for:

- TMDB 429s or timeout bursts.
- Discord 429s.
- Radarr/Sonarr queue or tag errors.
- Docs route errors.
- Migration startup errors.

## Radarr/Sonarr Download-Complete Webhook

Chanflix exposes `POST /api/v1/webhooks/servarr` so Radarr and Sonarr can
announce finished imports. On a download event it refreshes the download
queues immediately and triggers a Plex recently-added scan (debounced to at
most one scan per 60 seconds, skipped if one is already running), so
availability flips well before the 5-minute scheduled scan.

Authentication uses the shared webhook secret stored as `main.webhookSecret`
in `config/settings.json` (auto-generated on first read after upgrade). It is
independent of the admin API key on purpose — Radarr/Sonarr only get scan
nudging rights. Send it either as an `X-Webhook-Secret` header or a
`?secret=` query parameter.

Setup in Radarr and Sonarr (same steps for both):

1. Settings → Connect → `+` → Webhook.
2. Name: `Chanflix availability`.
3. Notification Triggers: enable **On Import Complete** (Radarr) / **On
   Import** (Sonarr). Optionally On Upgrade. Leave the rest off.
4. URL: `http://<chanflix-host>:5055/api/v1/webhooks/servarr?secret=<webhookSecret>`
   (or set URL without the query and add header `X-Webhook-Secret: <webhookSecret>`).
5. Method: `POST`. Save — the Test button should return success (202).

The secret's value can be read from `config/settings.json` on the server.
