#!/usr/bin/env bash
#
# Aretay backend helper — wraps the Supabase CLI for local dev and migrations.

set -euo pipefail
cd "$(dirname "$0")"

# ── colours ────────────────────────────────────────────────────────────────
B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'

usage() {
  cat <<EOF
${B}Aretay backend${N} — wraps the Supabase CLI.

${B}Usage:${N}
  ./run-backend.sh <command> [args]

${B}Local stack:${N}
  start              Boot local Supabase (Postgres + Auth + Studio in Docker)
  stop               Shut down local stack
  restart            stop + start
  status             Show URLs and keys for the running local stack
  keys               Print the SUPABASE_URL + SUPABASE_ANON_KEY for Secrets.xcconfig

${B}Migrations:${N}
  new <name>         Create a new timestamped migration file
  up                 Apply pending migrations to the local DB
  reset              Drop + re-create local DB and re-apply all migrations

${B}Remote (after \`link\`):${N}
  link <project-ref> Link to a remote Supabase project (one-time)
  push               Push local migrations to the linked remote project
  deploy-functions   Deploy all Edge Functions to the linked remote project

${B}Voice review dev:${N}
  serve-functions    Serve Edge Functions locally (reads supabase/functions/.env)
  voice-dev          Start stack + print iOS keys + serve functions (local test loop)

  help               Show this message
EOF
}

require_supabase() {
  if ! command -v supabase >/dev/null 2>&1; then
    printf "${R}error:${N} supabase CLI not found. Install with: brew install supabase/tap/supabase\n"
    exit 1
  fi
}

require_docker() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  # Docker Desktop's UI can be open while the Linux engine is still starting
  # (or stuck on a stale socket from a prior crash).
  if [[ -S "${HOME}/.docker/run/docker.sock" ]]; then
    printf "${R}error:${N} Docker Desktop is open but the engine isn't responding.\n"
    printf "  Quit Docker Desktop fully (menu → Quit), reopen it, and wait until\n"
    printf "  the whale icon stops animating and \`docker ps\` works in Terminal.\n"
  else
    printf "${R}error:${N} Docker is not running. Open Docker Desktop and try again.\n"
  fi
  exit 1
}

# Print SUPABASE_URL + SUPABASE_ANON_KEY in xcconfig-paste-ready form.
# xcconfig treats // as a comment so we escape it as /\$()/
print_xcconfig_keys() {
  local api_url anon_key xcconfig_url
  api_url=$(supabase status -o env 2>/dev/null | grep '^API_URL=' | cut -d'"' -f2)
  anon_key=$(supabase status -o env 2>/dev/null | grep '^ANON_KEY=' | cut -d'"' -f2)

  if [[ -z "$api_url" || -z "$anon_key" ]]; then
    printf "${R}error:${N} could not read local Supabase status. Is the stack running? Try: ./run-backend.sh start\n"
    exit 1
  fi

  xcconfig_url="${api_url/:\/\//:\/\$()\/}"

  printf "\n${B}Paste into aretay-ios/Config/Secrets.xcconfig:${N}\n\n"
  printf "  ${D}SUPABASE_URL = %s${N}\n"      "$xcconfig_url"
  printf "  ${D}SUPABASE_ANON_KEY = %s${N}\n\n" "$anon_key"
}

cmd_start() {
  require_supabase
  require_docker
  supabase start
  printf "\n${G}✔${N} Local Supabase is up.\n"
  print_xcconfig_keys
}

cmd_stop() {
  require_supabase
  supabase stop
}

cmd_restart() { cmd_stop; cmd_start; }

cmd_reset() {
  require_supabase
  require_docker
  supabase db reset
  printf "\n${G}✔${N} Database reset and migrations re-applied.\n"
}

cmd_status() {
  require_supabase
  supabase status
}

cmd_keys() {
  require_supabase
  print_xcconfig_keys
}

cmd_new() {
  require_supabase
  if [[ $# -lt 1 ]]; then
    printf "${R}error:${N} migration name required.\n  example: ./run-backend.sh new add_concept_fields\n"
    exit 1
  fi
  supabase migration new "$1"
}

cmd_up() {
  require_supabase
  supabase migration up
}

cmd_push() {
  require_supabase
  supabase db push
}

cmd_deploy_functions() {
  require_supabase
  # delete-account verifies the JWT itself, so it's deployed with --no-verify-jwt.
  supabase functions deploy delete-account --no-verify-jwt
  # The live-voice-review functions also verify the JWT in-handler (Bearer token).
  for fn in start-review-session submit-grade finish-review-session; do
    supabase functions deploy "$fn" --no-verify-jwt
  done
  printf "\n${G}✔${N} Edge Functions deployed.\n"
}

cmd_serve_functions() {
  require_supabase
  local env_file="supabase/functions/.env"
  if [[ ! -f "$env_file" ]]; then
    printf "${R}error:${N} missing %s — copy GEMINI_API_KEY + GEMINI_LIVE_MODEL there.\n" "$env_file"
    exit 1
  fi
  printf "${G}→${N} Serving Edge Functions at http://127.0.0.1:54321/functions/v1/ …\n"
  printf "${D}  (Ctrl+C to stop; keep this terminal open while testing on device/simulator)\n\n"
  supabase functions serve --env-file "$env_file" --no-verify-jwt
}

cmd_voice_dev() {
  require_supabase
  require_docker
  if ! docker ps >/dev/null 2>&1; then
    printf "${R}error:${N} Docker engine not ready — open Docker Desktop and wait until it says Running.\n"
    exit 1
  fi
  supabase start
  printf "\n${G}✔${N} Local Supabase is up (migration includes live_voice_review).\n\n"
  print_xcconfig_keys
  printf "${B}For voice review testing:${N}\n"
  printf "  1. Paste the SUPABASE_URL + SUPABASE_ANON_KEY above into aretay-ios/Config/Secrets.xcconfig\n"
  printf "     (prod URL won't have the new tables/functions until you deploy there)\n"
  printf "  2. Set LIVE_VOICE_REVIEW = 1 in Secrets.xcconfig (already on if you followed setup)\n"
  printf "  3. Run admin: ./aretay-admin/run-admin.sh — generate-review-asset on a question\n"
  printf "  4. In another terminal: ./run-backend.sh serve-functions\n"
  printf "  5. xcodegen + run on a ${B}real device${N} (mic required)\n\n"
  cmd_serve_functions
}

cmd_link() {
  require_supabase
  if [[ $# -lt 1 ]]; then
    printf "${R}error:${N} project ref required. Find it at https://supabase.com/dashboard\n"
    exit 1
  fi
  supabase link --project-ref "$1"
}

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    start)            cmd_start ;;
    stop)             cmd_stop ;;
    restart)          cmd_restart ;;
    reset)            cmd_reset ;;
    status)           cmd_status ;;
    keys)             cmd_keys ;;
    new)              cmd_new "$@" ;;
    up)               cmd_up ;;
    push)             cmd_push ;;
    deploy-functions) cmd_deploy_functions ;;
    serve-functions)  cmd_serve_functions ;;
    voice-dev)        cmd_voice_dev ;;
    link)             cmd_link "$@" ;;
    help|-h|--help|"") usage ;;
    *)                printf "${R}unknown command:${N} %s\n\n" "$cmd"; usage; exit 1 ;;
  esac
}

main "$@"
