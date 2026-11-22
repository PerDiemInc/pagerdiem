#!/usr/bin/env bash
# Local setup for PagerDiem: asks a few questions and writes a ready-to-run .env.
# Works on macOS, Linux and WSL. Run it again any time; it never overwrites a
# .env without asking (or --force).
set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE=".env"
ASSUME_YES=0
FORCE=0
INSTALL=1

usage() {
  cat <<'EOF'
Usage: ./init.sh [options]

Creates .env for running PagerDiem on your machine, installs dependencies and
offers to start it. Press Enter to accept the value shown in [brackets].

Options:
  -y, --yes         Accept every default and do not ask anything
  -f, --force       Replace an existing .env
      --no-install  Skip npm install
      --env-file F  Write to F instead of .env
  -h, --help        Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) ASSUME_YES=1 ;;
    -f|--force) FORCE=1 ;;
    --no-install) INSTALL=0 ;;
    --env-file)
      [ $# -ge 2 ] || { echo "--env-file needs a path" >&2; exit 1; }
      ENV_FILE="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

if [ -t 1 ]; then BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; RESET=$'\033[0m'; else BOLD=""; DIM=""; GREEN=""; RED=""; RESET=""; fi
say() { printf '%s\n' "$*"; }
step() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }
fail() { printf '%s%s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# ---------- checks ----------
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. PagerDiem needs Node.js 22.13 or newer: https://nodejs.org"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || fail "Node.js $(node -v) is too old. PagerDiem needs 22.13 or newer."
[ -f .env.example ] || fail "Run this from the PagerDiem folder: .env.example is missing."

if [ -e "$ENV_FILE" ] && [ "$FORCE" = 0 ]; then
  if [ "$ASSUME_YES" = 1 ]; then
    fail "$ENV_FILE already exists. Use --force to replace it."
  fi
  printf '%s already exists. Replace it? [y/N]: ' "$ENV_FILE"
  read -r reply || reply=""
  case "$reply" in y|Y|yes|YES) ;; *) say "Left $ENV_FILE as it is."; exit 0 ;; esac
fi

# ---------- prompts ----------
# ask VAR "Question" "default" [validator]
# The validator is a bash function that returns 0 for good input. At the end of
# input (no more answers) the default is used.
ask() {
  local var="$1" question="$2" default="$3" validator="${4:-}" reply
  while true; do
    if [ "$ASSUME_YES" = 1 ]; then reply="$default"
    else
      if [ -n "$default" ]; then printf '%s [%s]: ' "$question" "$default"; else printf '%s: ' "$question"; fi
      read -r reply || { reply=""; printf '\n'; }
      reply="${reply:-$default}"
    fi
    if [ -z "$validator" ] || [ -z "$reply" ] || "$validator" "$reply"; then
      printf -v "$var" '%s' "$reply"
      return 0
    fi
    [ "$ASSUME_YES" = 1 ] && fail "Default for \"$question\" is invalid: $reply"
  done
}

# ask_secret VAR "Question" [validator]: input is not shown. Blank skips it.
ask_secret() {
  local var="$1" question="$2" validator="${3:-}" reply
  while true; do
    printf '%s (hidden, Enter to skip): ' "$question"
    read -r -s reply || reply=""
    printf '\n'
    if [ -z "$reply" ] || [ -z "$validator" ] || "$validator" "$reply"; then
      printf -v "$var" '%s' "$reply"
      return 0
    fi
  done
}

confirm() { # confirm "Question" default(y|n)
  local reply default="$2"
  if [ "$ASSUME_YES" = 1 ]; then return 1; fi
  if [ "$default" = y ]; then printf '%s [Y/n]: ' "$1"; else printf '%s [y/N]: ' "$1"; fi
  read -r reply || reply=""
  reply="${reply:-$default}"
  case "$reply" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

plain()    { case "$1" in *\"*|*$'\n'*) say "  No quotes or line breaks, please."; return 1 ;; esac; }
is_port()  { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ] || { say "  Use a port from 1 to 65535."; return 1; }; }
is_domain() { [[ "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]] || { say "  Use a domain like example.com (no @)."; return 1; }; }
is_time()  { [[ "$1" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { say "  Use 24-hour time like 18:00."; return 1; }; }
is_count() { [[ "$1" =~ ^([1-9]|10)$ ]] || { say "  Use a whole number from 1 to 10."; return 1; }; }
is_days() {
  local d
  for d in $(printf '%s' "$1" | tr ',;' '  '); do
    case "$(printf '%s' "$d" | tr '[:lower:]' '[:upper:]' | cut -c1-3)" in SUN|MON|TUE|WED|THU|FRI|SAT) ;; *) say "  \"$d\" is not a day. Use names like FRI,SAT,SUN."; return 1 ;; esac
  done
  [ -n "$(printf '%s' "$1" | tr -d ' ,;')" ] || { say "  Pick at least one day."; return 1; }
}
is_tz()    { node -e 'new Intl.DateTimeFormat("en-US",{timeZone:process.argv[1]})' "$1" 2>/dev/null || { say "  Unknown time zone. Try America/New_York or Europe/London."; return 1; }; }
is_bot()   { [[ "$1" =~ ^xoxb-[A-Za-z0-9-]+$ ]] || { say "  A bot token starts with xoxb-"; return 1; }; }
is_chan()  { [[ "$1" =~ ^[CG][A-Z0-9]{7,}$ ]] || { say "  A channel ID looks like C0123456789."; return 1; }; }
is_team()  { [[ "$1" =~ ^T[A-Z0-9]{6,}$ ]] || { say "  A workspace ID looks like T0123456789."; return 1; }; }
is_claude_key() { [[ "$1" =~ ^sk-ant-[A-Za-z0-9_-]+$ ]] || { say "  A Claude API key starts with sk-ant-"; return 1; }; }
is_urls() {
  local u
  for u in $(printf '%s' "$1" | tr ',' ' '); do
    [[ "$u" =~ ^https?://[^[:space:]]+$ ]] || { say "  \"$u\" is not a URL. Use https://example.com/health"; return 1; }
  done
}
is_group() { [[ "$1" =~ ^S[A-Z0-9]{6,}$ ]] || { say "  A user group ID looks like S0123456789."; return 1; }; }

say "${BOLD}PagerDiem local setup${RESET}"
say "${DIM}Press Enter to accept the value in [brackets]. Everything can be changed later in .env.${RESET}"

step "Your team"
ask APP_NAME_V "App name" "PagerDiem" plain
ask TEAM_NAME_V "Team name" "Example Engineering" plain
ask DOMAIN_V "Company email domain (people sign up with it)" "example.com" is_domain
ask TZ_V "Time zone" "America/New_York" is_tz
ask PORT_V "Port" "3000" is_port

step "Who is on call"
ask DAYS_V "Days that need someone on call" "FRI,SAT,SUN" is_days
ask START_V "Shift starts on the first day at" "18:00" is_time
ask END_V "Shift ends the morning after the last day at" "09:00" is_time
ask PEOPLE_V "People on call per shift" "2" is_count

SLACK_ON=0
BOT_V=""; SIGN_V=""; CHAN_V=""; CHAN_NAME_V="on-call"; TEAMID_V=""; GROUP_V=""
step "Slack (optional)"
say "${DIM}Without Slack, messages are written to Settings > Recent messages instead of being sent.${RESET}"
if confirm "Connect Slack now?" n; then
  SLACK_ON=1
  ask_secret BOT_V "Bot token (xoxb-...)" is_bot
  ask_secret SIGN_V "Signing secret"
  ask CHAN_V "On-call channel ID (C0123456789)" "" is_chan
  ask CHAN_NAME_V "Channel name shown in messages" "on-call" plain
  ask TEAMID_V "Slack workspace ID (T0123456789)" "" is_team
  ask GROUP_V "User group ID to tag, like @engineers (optional)" "" is_group
  say "${DIM}Slack can only reach this machine through a public URL (for example a tunnel).${RESET}"
fi

PING_ON=0
KEY_V=""; SKILL_V="skills/ping.md"; URLS_V=""
step "/ping AI check (optional, off by default)"
say "${DIM}Lets engineers type /ping in Slack so an AI looks into a problem and replies. Needs your own Claude API key.${RESET}"
if confirm "Enable the /ping AI check?" n; then
  PING_ON=1
  ask_secret KEY_V "Claude API key (sk-ant-...)" is_claude_key
  ask SKILL_V "Skill file with your instructions" "skills/ping.md" plain
  ask URLS_V "Health URLs to check, comma-separated (optional)" "" is_urls
  [ -f "$SKILL_V" ] || say "${DIM}Note: $SKILL_V does not exist yet; a short default is used until you create it.${RESET}"
  [ -n "$KEY_V" ] || { say "No key given, so /ping stays off. Set ANTHROPIC_API_KEY later and PING_ENABLED=true."; PING_ON=0; }
fi

# ---------- write .env ----------
step "Writing $ENV_FILE"
rand_hex() { node -e 'process.stdout.write(require("crypto").randomBytes(+process.argv[1]).toString("hex"))' "$1"; }

umask 077
cp .env.example "$ENV_FILE"
chmod 600 "$ENV_FILE"

# set_var KEY VALUE: replaces the KEY= line, or appends it. Values with spaces or # are quoted.
set_var() {
  local key="$1" value="$2" tmp
  case "$value" in *[\ \#]*) value="\"$value\"" ;; esac
  tmp="$(mktemp)"
  KEY="$key" VALUE="$value" awk '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    index($0, k "=") == 1 && !done { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

DAYS_NORMALIZED="$(printf '%s' "$DAYS_V" | tr '[:lower:]' '[:upper:]' | tr -s ' ;,' ',' | sed 's/^,//; s/,$//')"

set_var PORT "$PORT_V"
set_var PUBLIC_URL "http://localhost:$PORT_V"
set_var SESSION_SECRET "$(rand_hex 32)"
set_var API_TOKEN "$(rand_hex 24)"
set_var CALENDAR_FEED_SECRET "$(rand_hex 24)"
set_var APP_NAME "$APP_NAME_V"
set_var TEAM_NAME "$TEAM_NAME_V"
set_var ALLOWED_EMAIL_DOMAINS "$(printf '%s' "$DOMAIN_V" | tr '[:upper:]' '[:lower:]')"
set_var TEAM_TIMEZONE "$TZ_V"
set_var ON_CALL_DAYS "$DAYS_NORMALIZED"
set_var ON_CALL_START "$START_V"
set_var ON_CALL_END "$END_V"
set_var PEOPLE_PER_WEEKEND "$PEOPLE_V"
if [ "$SLACK_ON" = 1 ]; then
  [ -z "$BOT_V" ] || set_var SLACK_BOT_TOKEN "$BOT_V"
  [ -z "$SIGN_V" ] || set_var SLACK_SIGNING_SECRET "$SIGN_V"
  [ -z "$CHAN_V" ] || set_var SLACK_ONCALL_CHANNEL "$CHAN_V"
  set_var SLACK_ONCALL_CHANNEL_NAME "$CHAN_NAME_V"
  [ -z "$TEAMID_V" ] || set_var SLACK_TEAM_ID "$TEAMID_V"
  [ -z "$GROUP_V" ] || set_var SLACK_ENGINEERS_GROUP_ID "$GROUP_V"
fi
if [ "$PING_ON" = 1 ]; then
  set_var PING_ENABLED true
  set_var ANTHROPIC_API_KEY "$KEY_V"
  set_var PING_SKILL_FILE "$SKILL_V"
  [ -z "$URLS_V" ] || set_var PING_CHECK_URLS "$(printf '%s' "$URLS_V" | tr -d ' ')"
fi
say "${GREEN}Saved${RESET} $ENV_FILE ${DIM}(only you can read it, and git ignores it)${RESET}"

# ---------- install and start ----------
if [ "$INSTALL" = 1 ]; then
  step "Installing dependencies"
  command -v npm >/dev/null 2>&1 || fail "npm is not installed. It comes with Node.js: https://nodejs.org"
  npm install --no-audit --no-fund
fi

step "Ready"
say "  Start it:      ${BOLD}npm start${RESET}"
say "  Open:          ${BOLD}http://localhost:$PORT_V${RESET}"
say "  Sign up with an @$(printf '%s' "$DOMAIN_V" | tr '[:upper:]' '[:lower:]') email. The first person to sign up becomes the admin."
say "  Run the tests: ${BOLD}npm test${RESET}"

if [ "$INSTALL" = 1 ] && confirm "Start PagerDiem now?" y; then
  exec npm start
fi
