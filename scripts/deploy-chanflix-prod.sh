#!/usr/bin/env sh
set -eu

REPO_DIR="/home/chan/code/git/chanflix"
COMPOSE_FILE="/home/chan/docker/docker-compose.yaml"

cd "$REPO_DIR"

CHANFLIX_COMMIT_TAG="$(git rev-parse --short=12 HEAD)"
export CHANFLIX_COMMIT_TAG

echo "Deploying Chanflix commit ${CHANFLIX_COMMIT_TAG}"

git diff --check
yarn test:unit
yarn typecheck

docker compose -f "$COMPOSE_FILE" build --no-cache chanflix
docker compose -f "$COMPOSE_FILE" up -d --force-recreate chanflix
docker compose -f "$COMPOSE_FILE" logs --tail 80 chanflix
