#!/bin/bash
set -u

APP_NAME="Crypto Metrics Dashboard"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT" || exit 1

printf "\nStarting %s locally...\n" "$APP_NAME"
printf "Project folder: %s\n\n" "$PROJECT_ROOT"

if ! command -v node >/dev/null 2>&1; then
  printf "Node.js is required. Install the LTS version from https://nodejs.org/ and run this file again.\n"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  printf "npm is required. Reinstall Node.js LTS from https://nodejs.org/ and run this file again.\n"
  exit 1
fi

node "$PROJECT_ROOT/scripts/start-local-dashboard.js"
