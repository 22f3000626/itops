#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/venv"
BACKEND_PORT=8000
FRONTEND_PORT=3000
BACKEND_PID=""

log() {
  printf '\n[%s] %s\n' "$1" "$2"
}

fail() {
  printf '\n[ERROR] %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    log INFO "Stopping backend (PID ${BACKEND_PID})..."
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

find_python() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi

  if command -v python >/dev/null 2>&1; then
    command -v python
    return
  fi

  fail "Python 3 is required. Install it first, for example with your package manager."
}

ensure_command() {
  local cmd="$1"
  local install_hint="$2"

  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "$cmd is required. $install_hint"
  fi
}

ensure_env_file() {
  if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    if [[ -f "$BACKEND_DIR/.env.example" ]]; then
      cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
      log INFO "Created backend/.env from backend/.env.example"
    else
      : > "$BACKEND_DIR/.env"
      log INFO "Created empty backend/.env"
    fi
  fi

  if ! grep -Eq '^OPENAI_API_KEY=.+$' "$BACKEND_DIR/.env"; then
    log WARN "OPENAI_API_KEY is not set in backend/.env. Agent features may fail until you add it."
  fi
}

wait_for_backend() {
  local attempts=30
  local url="http://127.0.0.1:${BACKEND_PORT}/health"

  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  fail "Backend did not become ready on ${url}. Check the terminal output above."
}

PYTHON_BIN="$(find_python)"
ensure_command npm "Install Node.js and npm, for example with apt, dnf, pacman, or nvm."
ensure_command curl "Install curl with your package manager."

log INFO "Using Python: $PYTHON_BIN"
log INFO "Using npm: $(command -v npm)"

if ! "$PYTHON_BIN" -m venv --help >/dev/null 2>&1; then
  fail "Python venv support is missing. On Debian/Ubuntu, install python3-venv."
fi

ensure_env_file

if [[ ! -d "$VENV_DIR" ]]; then
  log INFO "Creating backend virtual environment..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

log INFO "Installing backend dependencies..."
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"

log INFO "Installing frontend dependencies..."
npm --prefix "$FRONTEND_DIR" install

log INFO "Starting backend on http://localhost:${BACKEND_PORT} ..."
cd "$BACKEND_DIR"
"$VENV_DIR/bin/python" -m uvicorn app.main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT" &
BACKEND_PID=$!
cd "$ROOT_DIR"

wait_for_backend

log INFO "Backend docs: http://localhost:${BACKEND_PORT}/docs"
log INFO "Starting frontend on http://localhost:${FRONTEND_PORT} ..."
log INFO "Press Ctrl+C in this window to stop both services."

npm --prefix "$FRONTEND_DIR" run dev
