#!/bin/sh
set -eu

image="${1:-}"
api="${2:-}"
case "$image" in
  2cenq94k4kvxfmlfgmkmjrbn:[0-9a-f]*) ;;
  *)
    echo "Invalid product image: $image" >&2
    exit 2
    ;;
esac
case "$api" in
  2cenq94k4kvxfmlfgmkmjrbn-*) ;;
  *)
    echo "Invalid product API container: $api" >&2
    exit 2
    ;;
esac

worker="stopirex-worker"
followup="stopirex-followup-worker"
network="coolify"
release="${image##*:}"
release_short="$(printf '%s' "$release" | cut -c1-8)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
worker_backup="${worker}-backup-${release_short}-${stamp}"
followup_backup="${followup}-backup-${release_short}-${stamp}"
runtime_env="$(mktemp "/tmp/stopirex-runtime-${release_short}.XXXXXX.env")"
expected_env="$(mktemp "/tmp/stopirex-expected-${release_short}.XXXXXX.env")"
worker_env="$(mktemp "/tmp/${worker}-${release_short}.XXXXXX.env")"
followup_env="$(mktemp "/tmp/${followup}-${release_short}.XXXXXX.env")"

cleanup() {
  rm -f "$runtime_env" "$expected_env" "$worker_env" "$followup_env"
}
trap cleanup EXIT HUP INT TERM

docker image inspect "$image" >/dev/null
docker inspect "$api" "$worker" "$followup" >/dev/null

api_runtime="$(docker inspect "$api" --format '{{.Config.Image}}|{{.State.Running}}')"
if [ "$api_runtime" != "$image|true" ]; then
  echo "Product API is not running the requested image: $api_runtime" >&2
  exit 1
fi

chmod 600 "$runtime_env" "$expected_env" "$worker_env" "$followup_env"
# The newly healthy API is the release source of truth for runtime configuration.
# Container identity fields are generated separately for each Docker container.
docker inspect "$api" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -Ev '^(HOST|HOSTNAME|COOLIFY_CONTAINER_NAME)=' > "$runtime_env"
sort "$runtime_env" > "$expected_env"

rollback() {
  docker rm -f "$worker" "$followup" >/dev/null 2>&1 || true
  if docker inspect "$worker_backup" >/dev/null 2>&1; then
    docker rename "$worker_backup" "$worker"
    docker start "$worker" >/dev/null
  fi
  if docker inspect "$followup_backup" >/dev/null 2>&1; then
    docker rename "$followup_backup" "$followup"
    docker start "$followup" >/dev/null
  fi
  echo "ROLLBACK|$worker|$followup" >&2
}

docker stop "$worker" "$followup" >/dev/null
docker rename "$worker" "$worker_backup"
docker rename "$followup" "$followup_backup"

if ! docker create \
  --name "$worker" \
  --restart unless-stopped \
  --network "$network" \
  --env-file "$runtime_env" \
  "$image" sh -c "node dist/src/worker.js" >/dev/null; then
  rollback
  exit 1
fi

if ! docker create \
  --name "$followup" \
  --restart unless-stopped \
  --network "$network" \
  --env-file "$runtime_env" \
  "$image" sh -c "node dist/src/followupWorker.js" >/dev/null; then
  rollback
  exit 1
fi

if ! docker start "$worker" "$followup" >/dev/null; then
  rollback
  exit 1
fi

docker inspect "$worker" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -Ev '^(HOST|HOSTNAME|COOLIFY_CONTAINER_NAME)=' | sort > "$worker_env"
docker inspect "$followup" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -Ev '^(HOST|HOSTNAME|COOLIFY_CONTAINER_NAME)=' | sort > "$followup_env"
if ! cmp -s "$expected_env" "$worker_env" || ! cmp -s "$expected_env" "$followup_env"; then
  echo "Worker runtime environment does not match the released API" >&2
  rollback
  exit 1
fi

sleep 6
worker_running="$(docker inspect "$worker" --format '{{.State.Running}}')"
followup_running="$(docker inspect "$followup" --format '{{.State.Running}}')"
if [ "$worker_running" != "true" ] || [ "$followup_running" != "true" ]; then
  docker logs --tail 40 "$worker" >&2 || true
  docker logs --tail 40 "$followup" >&2 || true
  rollback
  exit 1
fi

echo "ROLLED|$worker|$followup|$image|backups=$worker_backup,$followup_backup"
