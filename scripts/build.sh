#!/usr/bin/env bash
# meow-cachebilling build: TS source -> lib/index.js (host) + lib/client.js (web).
# Delegates to build.mjs (esbuild); node_modules junction is expected at
# ./node_modules -> meow-smooth/node_modules (see scripts/link-workspace.ps1).
set -euo pipefail
cd "$(dirname "$0")/.."
node build.mjs
