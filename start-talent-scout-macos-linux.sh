#!/usr/bin/env sh
set -eu
PORT=17300

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

PIDS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  for PID in $PIDS; do
    PROCESS_NAME="$(ps -p "$PID" -o comm= 2>/dev/null || true)"
    PROCESS_BASENAME="$(basename "$PROCESS_NAME")"
    case "$PROCESS_BASENAME" in
      node|nodejs)
        echo "Stopping existing Node process on port $PORT: PID $PID"
        kill "$PID" 2>/dev/null || true
        ;;
      *)
        echo "Port $PORT is already used by $PROCESS_NAME (PID $PID). Close it manually or choose another port."
        exit 1
        ;;
    esac
  done

  sleep 1

  for PID in $PIDS; do
    if kill -0 "$PID" 2>/dev/null; then
      PROCESS_NAME="$(ps -p "$PID" -o comm= 2>/dev/null || true)"
      PROCESS_BASENAME="$(basename "$PROCESS_NAME")"
      case "$PROCESS_BASENAME" in
        node|nodejs)
          echo "Force stopping Node process on port $PORT: PID $PID"
          kill -9 "$PID" 2>/dev/null || true
          ;;
      esac
    fi
  done
fi

echo "Starting Talent Scout at http://localhost:$PORT ..."
npm run start
