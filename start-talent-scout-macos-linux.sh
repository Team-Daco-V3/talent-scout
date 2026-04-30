#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run Talent Scout."
  echo "Install Node.js 20.19 or newer, then run this file again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Reinstall Node.js with npm enabled."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting Talent Scout at http://localhost:50224 ..."
npm run start
