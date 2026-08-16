#!/bin/sh

set -u

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT_DIR" || exit 1

printf '\n%s\n' "============================================================"
printf '%s\n' "  Family Travel Command Center - macOS/Linux Start Here"
printf '%s\n\n' "============================================================"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "ERROR: Node.js was not found on this computer."
  printf '%s\n' "Install Node.js 22.13 or newer from the official download page:"
  printf '%s\n' "https://nodejs.org/en/download"
  exit 1
fi

NODE_VERSION=$(node -p "process.versions.node" 2>/dev/null || true)
if ! node -e "const [major, minor, patch] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && (minor > 13 || (minor === 13 && patch >= 0))) ? 0 : 1)"; then
  printf '%s\n' "ERROR: Node.js ${NODE_VERSION:-unknown} is installed, but version 22.13 or newer is required."
  printf '%s\n' "Download a supported version from the official Node.js site:"
  printf '%s\n' "https://nodejs.org/en/download"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' "ERROR: npm was not found. A standard Node.js installation includes npm."
  printf '%s\n' "Reinstall Node.js 22.13 or newer from:"
  printf '%s\n' "https://nodejs.org/en/download"
  exit 1
fi

printf '%s\n\n' "Node.js $NODE_VERSION is ready."
printf '%s\n' "[1/3] Checking and installing project dependencies..."
printf '%s\n' "      Existing current packages will be reused."
if ! npm install --no-audit --no-fund; then
  printf '\n%s\n' "ERROR: Project dependencies could not be installed."
  printf '%s\n' "Check your internet connection and the messages above, then run this file again."
  exit 1
fi

printf '\n%s\n' "[2/3] Regenerating the app from the two files in the data folder..."
if ! npm run regenerate; then
  printf '\n%s\n' "ERROR: Your trip files could not be regenerated."
  printf '%s\n' "Check the messages above. The JSON or packing Markdown may need correction."
  exit 1
fi

printf '\n%s\n' "[3/3] Starting the private local development server..."
printf '%s\n' "      Keep this terminal open while using the app."
printf '%s\n\n' "      Press Ctrl+C here when you are finished."

exec node scripts/start-here.mjs
