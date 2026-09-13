#!/usr/bin/env bash
# Invoked over SSH with the verified archive already in incoming/.
set -Eeuo pipefail
umask 077
root=${1:?deployment root required}
sha=${2:?commit SHA required}
checksum=${3:?archive SHA256 required}
project=${4:-kadr}
[[ "$root" =~ ^/[a-zA-Z0-9_/-]+$ && "$root" != / && "$root" != */ ]] || { echo 'Invalid deployment root' >&2; exit 2; }
[[ "$sha" =~ ^[a-f0-9]{40}$ && "$checksum" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid release identity' >&2; exit 2; }
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid Compose project' >&2; exit 2; }
mkdir -p "$root/releases" "$root/shared"
exec 9>"$root/deploy.lock"
flock -w 600 9
[[ -f "$root/shared/.env" ]] || { echo "Configure $root/shared/.env first" >&2; exit 2; }
archive="$root/incoming/$sha.tar.gz"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
release="$root/releases/$sha"
mkdir -p "$release"
if [[ ! -f "$release/.extracted" ]]; then
  tar --no-same-owner -xzf "$archive" -C "$release"
  touch "$release/.extracted"
fi
previous=''
if [[ -L "$root/current" ]]; then
  previous=$(readlink -f "$root/current")
  [[ "$previous" == "$root/releases/"* && "${previous##*/}" =~ ^[a-f0-9]{40}$ && -d "$previous" ]] || { echo 'Invalid current release link' >&2; exit 2; }
fi
compose() {
  local dir=$1
  shift
  if [[ -f "$dir/images.env" ]]; then
    DEPLOY_SHA="${dir##*/}" docker compose --project-name "$project" \
      --env-file "$root/shared/.env" --env-file "$dir/images.env" \
      -f "$dir/compose.production.yaml" "$@"
  else
    # Allow rollback to releases from the former server-build workflow.
    DEPLOY_SHA="${dir##*/}" DEPLOY_PROJECT="$project" docker compose \
      --project-name "$project" --env-file "$root/shared/.env" \
      -f "$dir/compose.yaml" -f "$dir/compose.production.yaml" "$@"
  fi
}
compose "$release" config --quiet
# Pull both pinned images before replacing any running containers.
compose "$release" pull
rollback() {
  local status=$?
  trap - ERR HUP INT TERM
  echo "Release $sha failed; deployment remains failed." >&2
  if [[ -n "$previous" ]]; then
    if compose "$previous" up -d --no-build --pull never --wait --wait-timeout 180; then
      echo "Restored containers from ${previous##*/}. Database was not reverted." >&2
    else
      echo 'Rollback failed; inspect Docker health and restore manually.' >&2
    fi
  else
    echo 'No previous release; inspect Docker health before retrying.' >&2
  fi
  exit "$status"
}
# No down, volume deletion, image pruning, or database restore during deployment.
trap rollback ERR
trap 'false' HUP INT TERM
compose "$release" up -d --no-build --pull never --wait --wait-timeout 180
ln -sfn "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
trap - ERR HUP INT TERM
rm -f "$archive"
echo "Deployed $sha"
