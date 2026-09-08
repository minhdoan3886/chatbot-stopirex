#!/bin/sh
set -eu

image="${1:-}"
case "$image" in
  2cenq94k4kvxfmlfgmkmjrbn:[0-9a-f]*) ;;
  *)
    echo "Invalid product image: $image" >&2
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
worker_env="$(mktemp "/tmp/${worker}-${release_short}.XXXXXX.env")"
followup_env="$(mktemp "/tmp/${followup}-${release_short}.XXXXXX.env")"

cleanup() {
  rm -f "$worker_env" "$followup_env"
}
trap cleanup EXIT HUP INT TERM

docker image inspect "$image" >/dev/null
docker inspect "$worker" "$followup" >/dev/null

worker_current="$(docker inspect "$worker" --format '{{.Config.Image}}|{{.State.Running}}')"
followup_current="$(docker inspect "$followup" --format '{{.Config.Image}}|{{.State.Running}}')"
if [ "$worker_current" = "$image|true" ] && [ "$followup_current" = "$image|true" ]; then
  echo "CURRENT|$worker|$followup|$image"
  exit 0
fi

chmod 600 "$worker_env" "$followup_env"
docker inspect "$worker" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$worker_env"
docker inspect "$followup" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$followup_env"

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
  --env-file "$worker_env" \
  "$image" sh -c "node dist/src/worker.js" >/dev/null; then
  rollback
  exit 1
fi

if ! docker create \
  --name "$followup" \
  --restart unless-stopped \
  --network "$network" \
  --env-file "$followup_env" \
  "$image" sh -c "node dist/src/followupWorker.js" >/dev/null; then
  rollback
  exit 1
fi

if ! docker start "$worker" "$followup" >/dev/null; then
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
