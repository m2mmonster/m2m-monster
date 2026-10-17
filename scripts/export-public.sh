#!/usr/bin/env bash
# Exports the committed tree of this (private) repository to the public repository, without
# internal documents, and commits it there with a neutral identity. History is never copied.
#   scripts/export-public.sh <path-to-public-clone> "<commit message>"
# Requires PUBLIC_GIT_NAME and PUBLIC_GIT_EMAIL. Review the diff before pushing.
set -euo pipefail

dest="${1:?path to the public repository clone}"
message="${2:?commit message}"
: "${PUBLIC_GIT_NAME:?set PUBLIC_GIT_NAME}" "${PUBLIC_GIT_EMAIL:?set PUBLIC_GIT_EMAIL}"

# Paths that never leave the private repository.
EXCLUDE=(CLAUDE.md docs deploy/EASYPANEL.md apps/api/manual)

root="$(git rev-parse --show-toplevel)"
mkdir -p "$dest"
[ -d "$dest/.git" ] || git -C "$dest" init -q -b main

# Replace everything except .git with the exported tree of HEAD.
find "$dest" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
pathspecs=(.)
for path in "${EXCLUDE[@]}"; do pathspecs+=(":(exclude)$path"); done
git -C "$root" archive --format=tar HEAD -- "${pathspecs[@]}" | tar -x -C "$dest"

for path in "${EXCLUDE[@]}"; do
  if [ -e "$dest/$path" ]; then echo "refusing: $path was exported" >&2; exit 1; fi
done

git -C "$dest" add -A

# Copy the git mode of every exported file from the private tree: extraction loses the
# executable bit where the filesystem does not keep it (Windows, core.fileMode=false).
while IFS=$'\t' read -r meta path; do
  [ -e "$dest/$path" ] || continue # excluded
  case "${meta%% *}" in
    100755) git -C "$dest" update-index --chmod=+x -- "$path" ;;
    100644) git -C "$dest" update-index --chmod=-x -- "$path" ;;
  esac
done < <(git -C "$root" ls-tree -r HEAD)

git -C "$dest" -c user.name="$PUBLIC_GIT_NAME" -c user.email="$PUBLIC_GIT_EMAIL" \
  commit -q -m "$message" && git -C "$dest" log --oneline -1
