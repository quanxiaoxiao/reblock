#!/bin/sh
set -eu

HURL_ENV="${HURL_ENV:-local}"
TEST_PORT="${TEST_PORT:-4362}"
BASE_URL=""
SERVER_LOG="${SERVER_LOG:-/tmp/reblock-hurl-server.log}"

cleanup() {
  if [ "${SERVER_PID:-}" != "" ]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

npm run -s build

if command -v nc >/dev/null 2>&1; then
  base_port="${TEST_PORT}"
  p="${base_port}"
  while nc -z 127.0.0.1 "${p}" >/dev/null 2>&1; do
    p=$((p + 1))
    if [ "${p}" -gt $((base_port + 20)) ]; then
      echo "No free port found in range ${base_port}-${base_port}+20" >&2
      exit 1
    fi
  done
  TEST_PORT="${p}"
fi

BASE_URL="http://127.0.0.1:${TEST_PORT}"

NODE_ENV=test PORT="${TEST_PORT}" node dist/server.js >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

i=0
until curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "${i}" -ge 60 ]; then
    echo "Server failed to become ready on ${BASE_URL}. Log: ${SERVER_LOG}" >&2
    exit 1
  fi
  sleep 0.5
done

hurl \
  --test \
  --variables-file "tests/hurl/env/${HURL_ENV}.env" \
  --variable BASE_URL="${BASE_URL}" \
  --variable timestamp="$(date +%s)" \
  --variable date="$(date +%Y-%m-%d)" \
  tests/hurl
