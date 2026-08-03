#!/bin/bash
# Test health endpoint and verify response
# Usage: ./scripts/test-health.sh [URL]
# Default: http://localhost:8787

set -euo pipefail

URL="${1:-http://localhost:8787}"
ENDPOINT="${URL}/health"
TMPFILE=$(mktemp)
trap 'rm -f "${TMPFILE}"' EXIT

echo "Testing health endpoint: ${ENDPOINT}"
echo "---"

# Fetch with HTTP status code. Keep curl's exit status separate from its `000` output.
if ! HTTP_CODE=$(curl -sS -o "${TMPFILE}" -w "%{http_code}" "${ENDPOINT}"); then
  echo "FAIL: Cannot connect to ${ENDPOINT}"
  exit 1
fi

# Check HTTP status
if [ "${HTTP_CODE}" != "200" ]; then
  echo "FAIL: /health returned HTTP ${HTTP_CODE} (expected 200)"
  echo "Response:"
  cat "${TMPFILE}"
  exit 1
fi

# Check JSON structure
if ! command -v jq &> /dev/null; then
  echo "WARN: jq not installed, skipping JSON validation"
  echo "PASS: /health returned HTTP 200"
  cat "${TMPFILE}"
  exit 0
fi

STATUS=$(jq -r '.status' "${TMPFILE}" 2>/dev/null || echo "")
TIMESTAMP=$(jq -r '.timestamp' "${TMPFILE}" 2>/dev/null || echo "")

if [ "${STATUS}" != "ok" ]; then
  echo "FAIL: .status is '${STATUS}', expected 'ok'"
  echo "Response:"
  jq . "${TMPFILE}" 2>/dev/null || cat "${TMPFILE}"
  exit 1
fi

if [ -z "${TIMESTAMP}" ] || [ "${TIMESTAMP}" = "null" ]; then
  echo "WARN: .timestamp is missing or null"
fi

echo "PASS: /health returned 200 with status=ok"
jq . "${TMPFILE}" 2>/dev/null || cat "${TMPFILE}"
exit 0
