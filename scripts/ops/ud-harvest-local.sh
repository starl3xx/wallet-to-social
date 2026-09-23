#!/bin/bash
# Runs an Unstoppable Domains harvest from this Mac instead of GitHub Actions.
#
# WHY THIS EXISTS. Since the evening of 2026-09-20 the keyless UD profile
# endpoint answers 406 to GitHub's runner IPs. It is an IP block, not an
# outage: on 2026-09-21 and again on 2026-09-23 the names a runner was refused
# returned 200 from a home network in the same minute. Waiting does not clear
# an IP block, so the harvest runs where the endpoint answers. The GitHub
# workflows keep workflow_dispatch only.
#
# launchd calls this through the agents that install-ud-harvest-agents.sh
# writes. By hand:
#   scripts/ops/ud-harvest-local.sh domains    # harvest-ud-domains.ts --commit
#   scripts/ops/ud-harvest-local.sh profiles   # harvest-ud-profiles.ts --walk --commit
# UD_HARVEST_NO_NOTIFY=1 skips the macOS notification (for testing by hand).
#
# Each run takes a lock, moves this worktree to origin/main, runs npm ci when
# the lockfile changed, runs the harvest, and posts a macOS notification when
# it fails. A run on a blocked endpoint fails at the harvest's own circuit
# breaker after 50 refused names, with the checkpoint left behind the unread
# domains, so a red run loses nothing.
#
# Credentials come from ~/.config/walletlink/ud-harvest.env (DATABASE_URL,
# optional ALCHEMY_KEY), never from .env.local: .env.local connects as the
# owner role. The agents connect as ud_harvester, which can read and write
# the three tables the ingest touches (social_graph, handle_conflicts,
# ingest_state) and nothing else; scripts/migrate-create-ud-harvester.ts
# creates it and writes its URL into the env file.
#
# The whole body is one function, so bash has parsed all of it before
# `git checkout` can rewrite this file underneath the running shell.

main() {
  set -uo pipefail
  export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

  local job="${1:-}"
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  local env_file="${UD_HARVEST_ENV:-$HOME/.config/walletlink/ud-harvest.env}"
  local lock="${TMPDIR:-/tmp}/walletlink-ud-harvest.lock"
  local script
  local -a args

  case "$job" in
    domains)
      script=scripts/harvest-ud-domains.ts
      args=(--commit --max-reads "${UD_HARVEST_MAX_READS:-40000}")
      ;;
    profiles)
      script=scripts/harvest-ud-profiles.ts
      args=(--walk --commit --max-requests "${UD_HARVEST_MAX_REQUESTS:-3000}")
      ;;
    *)
      echo "usage: $0 domains|profiles" >&2
      return 2
      ;;
  esac

  log() { printf '%s [ud-%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$job" "$*"; }
  notify() {
    [ "${UD_HARVEST_NO_NOTIFY:-}" = "1" ] && return 0
    local msg="${1//\"/\'}"
    osascript -e "display notification \"$msg\" with title \"walletlink UD harvest ($job)\"" \
      >/dev/null 2>&1 || true
  }
  fail() {
    log "FAILED: $*"
    notify "$*"
    return 1
  }

  # Credentials: present, private, and not the owner role.
  [ -f "$env_file" ] || { fail "missing $env_file (see install-ud-harvest-agents.sh)"; return 1; }
  if [ "$(stat -f %Lp "$env_file")" != "600" ]; then
    fail "$env_file must be chmod 600"
    return 1
  fi
  local url user
  url="$(grep -E '^DATABASE_URL=' "$env_file" | head -1 | cut -d= -f2- | tr -d "\"'")"
  user="${url#*://}"
  user="${user%%:*}"
  if [ -z "$url" ] || [ "$user" = "$url" ]; then
    fail "DATABASE_URL in $env_file is empty or not a postgres URL"
    return 1
  fi
  if [ "$user" = "neondb_owner" ]; then
    fail "DATABASE_URL connects as neondb_owner; use ud_harvester (scripts/migrate-create-ud-harvester.ts)"
    return 1
  fi

  # One harvest at a time: both jobs share the ingest tables and this worktree.
  if ! mkdir "$lock" 2>/dev/null; then
    local pid
    pid="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log "another harvest (pid $pid) holds the lock; skipping this run"
      return 0
    fi
    rm -rf "$lock"
    mkdir "$lock" || { fail "cannot take $lock"; return 1; }
  fi
  echo $$ >"$lock/pid"
  # Expanded now: the trap fires after main returns, when $lock is out of scope.
  # shellcheck disable=SC2064
  trap "rm -rf '$lock'" EXIT

  cd "$root" || { fail "cannot cd to $root"; return 1; }
  # Never move a working checkout: this must be the dedicated, detached worktree.
  if git symbolic-ref -q HEAD >/dev/null; then
    fail "$root is on a branch; run from the detached harvest worktree"
    return 1
  fi
  git fetch -q origin main || { fail "git fetch failed"; return 1; }
  git checkout -q --detach origin/main || { fail "git checkout origin/main failed"; return 1; }

  local want have
  want="$(git hash-object package-lock.json)"
  have="$(cat node_modules/.ud-harvest-lock-sha 2>/dev/null || true)"
  if [ "$want" != "$have" ]; then
    log "lockfile changed; npm ci"
    npm ci --no-audit --no-fund >/dev/null 2>&1 || { fail "npm ci failed"; return 1; }
    echo "$want" >node_modules/.ud-harvest-lock-sha
  fi

  log "start at $(git rev-parse --short HEAD): $script ${args[*]}"
  npx tsx --env-file="$env_file" "$script" "${args[@]}" 2>&1 | tee "$lock/out"
  local rc=${PIPESTATUS[0]}
  if [ "$rc" -ne 0 ]; then
    local why
    why="$(grep -m1 -E '^[A-Za-z]*Error' "$lock/out" | cut -c1-160)"
    fail "exit $rc: ${why:-see ~/Library/Logs/walletlink-ud-harvest.log}"
    return 1
  fi
  log "done"
}

main "$@"
exit $?
