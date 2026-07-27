#!/bin/bash
set -u

APP_NAME="Crypto Metrics Dashboard"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT" || exit 1

printf "\nStarting %s locally...\n" "$APP_NAME"
printf "Project folder: %s\n\n" "$PROJECT_ROOT"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  BREW_BIN=""
  if command -v brew >/dev/null 2>&1; then
    BREW_BIN="$(command -v brew)"
  elif [ -x /opt/homebrew/bin/brew ]; then
    BREW_BIN="/opt/homebrew/bin/brew"
  elif [ -x /usr/local/bin/brew ]; then
    BREW_BIN="/usr/local/bin/brew"
  fi

  if [ -z "$BREW_BIN" ]; then
    printf "Node.js LTS and npm are required.\n"
    printf "Homebrew was not found, so automatic installation is unavailable.\n"
    printf "Install Node.js LTS from https://nodejs.org/ and run this file again.\n"
    exit 1
  fi

  printf "Node.js LTS and npm are needed to run this dashboard.\n"
  printf "Install Node.js automatically with Homebrew now? [Y/N] "
  read -r ANSWER
  case "$ANSWER" in
    y|Y|yes|YES|Yes) ;;
    *)
      printf "Installation cancelled. You can install Node.js LTS from https://nodejs.org/.\n"
      exit 1
      ;;
  esac

  printf "Installing Node.js with Homebrew. This can take several minutes...\n"
  if ! "$BREW_BIN" install node; then
    printf "Node.js installation failed. Install it from https://nodejs.org/ and try again.\n"
    exit 1
  fi

  eval "$("$BREW_BIN" shellenv)"
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    printf "Node.js was installed, but this window cannot see it yet.\n"
    printf "Close this window and double-click the launcher again.\n"
    exit 1
  fi
fi

node "$PROJECT_ROOT/scripts/start-local-dashboard.js"
