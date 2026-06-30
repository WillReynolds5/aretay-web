#!/usr/bin/env bash
#
# Deploy Aretay's production Supabase backend: remote migrations + Edge Functions.

set -euo pipefail
cd "$(dirname "$0")"

B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
DEFAULT_PROJECT_REF="rtrkltfoaxewosbzrlep"

usage() {
  cat <<EOF
${B}Aretay production deploy${N}

${B}Usage:${N}
  ./deploy-prod.sh [options]

${B}Options:${N}
  --project-ref <ref>    Override the default Supabase project ref (${DEFAULT_PROJECT_REF})
  --skip-migrations      Do not run \`supabase db push\`
  --skip-functions       Do not deploy Edge Functions
  --yes                  Skip the production confirmation prompt
  -h, --help             Show this message

${B}Examples:${N}
  ./deploy-prod.sh
  ./deploy-prod.sh --project-ref abcdefghijklmnopqrst
  ./deploy-prod.sh --yes
EOF
}

require_supabase() {
  if ! command -v supabase >/dev/null 2>&1; then
    printf "${R}error:${N} supabase CLI not found. Install with: brew install supabase/tap/supabase\n"
    exit 1
  fi
}

linked_project_ref() {
  local ref_file="supabase/.temp/project-ref"
  if [[ -f "$ref_file" ]]; then
    tr -d '[:space:]' < "$ref_file"
  fi
}

confirm_production() {
  if [[ "$ASSUME_YES" == "1" || "${CI:-}" == "true" ]]; then
    return 0
  fi

  local ref
  ref="$(linked_project_ref)"
  printf "${Y}This will deploy to the linked Supabase project${N}"
  if [[ -n "$ref" ]]; then
    printf " (${B}%s${N})" "$ref"
  fi
  printf ".\n"
  printf "Type ${B}deploy${N} to continue: "

  local answer
  read -r answer
  if [[ "$answer" != "deploy" ]]; then
    printf "${R}aborted:${N} confirmation did not match.\n"
    exit 1
  fi
}

deploy_migrations() {
  printf "\n${G}->${N} Applying production migrations with ${B}supabase db push${N}...\n"
  supabase db push
}

deploy_functions() {
  printf "\n${G}->${N} Deploying Edge Functions...\n"

  local deployed=0
  local fn_dir fn
  for fn_dir in supabase/functions/*; do
    [[ -d "$fn_dir" ]] || continue
    fn="$(basename "$fn_dir")"
    [[ "$fn" == _* ]] && continue

    # These functions verify the caller's JWT in-handler, so Supabase's gateway
    # JWT check stays disabled for parity with local `functions serve`.
    printf "${D}   deploying %s${N}\n" "$fn"
    supabase functions deploy "$fn" \
      --project-ref "$PROJECT_REF" \
      --no-verify-jwt \
      --use-api
    deployed=$((deployed + 1))
  done

  if [[ "$deployed" -eq 0 ]]; then
    printf "${Y}warning:${N} no Edge Functions found under supabase/functions.\n"
  fi
}

PROJECT_REF="$DEFAULT_PROJECT_REF"
SKIP_MIGRATIONS=0
SKIP_FUNCTIONS=0
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-ref)
      if [[ $# -lt 2 || "$2" == -* ]]; then
        printf "${R}error:${N} --project-ref requires a value.\n"
        exit 1
      fi
      PROJECT_REF="$2"
      shift 2
      ;;
    --skip-migrations)
      SKIP_MIGRATIONS=1
      shift
      ;;
    --skip-functions)
      SKIP_FUNCTIONS=1
      shift
      ;;
    --yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf "${R}unknown option:${N} %s\n\n" "$1"
      usage
      exit 1
      ;;
  esac
done

require_supabase

printf "${G}->${N} Linking Supabase project ${B}%s${N}...\n" "$PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"

if [[ "$SKIP_MIGRATIONS" == "1" && "$SKIP_FUNCTIONS" == "1" ]]; then
  printf "${R}error:${N} both --skip-migrations and --skip-functions were provided; nothing to deploy.\n"
  exit 1
fi

confirm_production

if [[ "$SKIP_MIGRATIONS" != "1" ]]; then
  deploy_migrations
fi

if [[ "$SKIP_FUNCTIONS" != "1" ]]; then
  deploy_functions
fi

printf "\n${G}done:${N} production deploy completed.\n"
