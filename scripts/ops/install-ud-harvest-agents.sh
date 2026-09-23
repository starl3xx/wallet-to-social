#!/bin/bash
# Installs the two launchd agents that run the Unstoppable Domains harvests
# from this Mac (see ud-harvest-local.sh for why they cannot run on GitHub).
#
#   scripts/ops/install-ud-harvest-agents.sh              # install or refresh
#   scripts/ops/install-ud-harvest-agents.sh --uninstall  # unload and remove
#
# What it sets up:
#   ~/.walletlink-harvest                    a detached worktree of origin/main
#                                            that only the agents use, so a run
#                                            never moves a checkout you work in
#   ~/.config/walletlink/ud-harvest.env      DATABASE_URL (ud_harvester) and
#                                            ALCHEMY_KEY, chmod 600
#   ~/Library/LaunchAgents/social.walletlink.ud-domain-harvest.plist
#                                            daily at 09:15 and 21:15 local
#   ~/Library/LaunchAgents/social.walletlink.ud-profile-harvest.plist
#                                            Sundays at 02:45 local
#   ~/Library/Logs/walletlink-ud-harvest.log both agents append here
#
# The times match the old workflow crons in CDT (14:15/02:15 and Sunday 07:45
# UTC). launchd runs a slot missed while the Mac slept once it wakes.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && git rev-parse --show-toplevel)"
WT="$HOME/.walletlink-harvest"
ENV_DIR="$HOME/.config/walletlink"
ENV_FILE="$ENV_DIR/ud-harvest.env"
AGENTS="$HOME/Library/LaunchAgents"
LOG="$HOME/Library/Logs/walletlink-ud-harvest.log"
DOMAIN_LABEL=social.walletlink.ud-domain-harvest
PROFILE_LABEL=social.walletlink.ud-profile-harvest
UID_NUM="$(id -u)"

unload() {
  local label="$1"
  launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
}

if [ "${1:-}" = "--uninstall" ]; then
  for label in "$DOMAIN_LABEL" "$PROFILE_LABEL"; do
    unload "$label"
    rm -f "$AGENTS/$label.plist"
    echo "removed $label"
  done
  echo "Kept $WT and $ENV_FILE. Delete them by hand if you want them gone."
  exit 0
fi

# 1. The dedicated worktree, detached at origin/main.
git -C "$REPO" fetch -q origin main
if [ ! -d "$WT" ]; then
  git -C "$REPO" worktree add -q --detach "$WT" origin/main
  echo "created worktree $WT"
fi
(cd "$WT" && npm ci --no-audit --no-fund >/dev/null && git hash-object package-lock.json >node_modules/.ud-harvest-lock-sha)

# 2. The credentials file. Never overwritten once it exists.
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat >"$ENV_FILE" <<'EOF'
# Credentials for the UD harvest agents (scripts/ops/ud-harvest-local.sh).
# DATABASE_URL connects as ud_harvester, never neondb_owner (the wrapper
# refuses the owner role). Fill it with, from ~/wallet-to-social:
#   npx tsx --env-file=.env.local scripts/migrate-create-ud-harvester.ts
DATABASE_URL=
# Optional: without it the log scan uses public RPC endpoints, which is slower.
ALCHEMY_KEY=
EOF
  echo "created $ENV_FILE: run scripts/migrate-create-ud-harvester.ts to fill DATABASE_URL"
fi
chmod 600 "$ENV_FILE"

# 3. The agents.
mkdir -p "$AGENTS" "$(dirname "$LOG")"
write_plist() {
  local label="$1" job="$2" intervals="$3"
  cat >"$AGENTS/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$WT/scripts/ops/ud-harvest-local.sh</string>
    <string>$job</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
$intervals
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>Nice</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
EOF
  plutil -lint -s "$AGENTS/$label.plist"
  unload "$label"
  launchctl bootstrap "gui/$UID_NUM" "$AGENTS/$label.plist"
  echo "loaded $label"
}

slot() { printf '    <dict>%s</dict>\n' "$1"; }
write_plist "$DOMAIN_LABEL" domains "$(
  slot '<key>Hour</key><integer>9</integer><key>Minute</key><integer>15</integer>'
  slot '<key>Hour</key><integer>21</integer><key>Minute</key><integer>15</integer>'
)"
write_plist "$PROFILE_LABEL" profiles "$(
  slot '<key>Weekday</key><integer>0</integer><key>Hour</key><integer>2</integer><key>Minute</key><integer>45</integer>'
)"

echo
echo "Run one now:  launchctl kickstart gui/$UID_NUM/$DOMAIN_LABEL"
echo "Watch it:     tail -f $LOG"
