#!/bin/sh
# Project-local test environment for macOS (Homebrew). Does not change global defaults.
# Usage: scripts/local-env.sh npm test | npm run test:e2e | npm run test:parity
# Loopback emulators and fictional data only; no deploy command, no live credentials.
set -eu
BREW="${HOMEBREW_PREFIX:-/opt/homebrew}"
PATH="$BREW/opt/node@22/bin:$PATH"
export PATH
export INVOICE_JAVA="${INVOICE_JAVA:-$BREW/opt/openjdk@21/bin/java}"
export INVOICE_FIREBASE_LIB="${INVOICE_FIREBASE_LIB:-$BREW/lib/node_modules/firebase-tools/lib/}"
export CHROME_PATH="${CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Node 22+ required" >&2; exit 1; }
exec "$@"
