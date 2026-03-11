#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# run-interop.sh — Block K: Official hazelcast-client Interop Test Runner
#
# Usage:
#   ./test/interop/run-interop.sh               # run all suites
#   ./test/interop/run-interop.sh map           # run specific suite
#   ./test/interop/run-interop.sh connection map lifecycle
#
# Exit code:
#   0 — all tests passed
#   1 — at least one test failed or infrastructure error
#
# Environment variables:
#   INTEROP_TIMEOUT    — per-test timeout in milliseconds (default: 60000)
#   INTEROP_SKIP_INSTALL — set to "1" to skip npm install
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INTEROP_DIR="$SCRIPT_DIR"
TIMEOUT="${INTEROP_TIMEOUT:-60000}"

# ANSI colour codes (disabled if not a TTY)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' RESET=''
fi

log()    { echo -e "${CYAN}[interop]${RESET} $*"; }
success(){ echo -e "${GREEN}[interop]${RESET} $*"; }
warn()   { echo -e "${YELLOW}[interop]${RESET} $*"; }
error()  { echo -e "${RED}[interop]${RESET} $*" >&2; }

# ── Resolve which suites to run ───────────────────────────────────────────────

ALL_SUITES=(connection map queue topic collections multimap replicatedmap atomics flakeid pncounter lifecycle harness-baseline)

if [ $# -gt 0 ]; then
  SUITES=("$@")
else
  SUITES=("${ALL_SUITES[@]}")
fi

# ── Step 1: Install dependencies ──────────────────────────────────────────────

if [ "${INTEROP_SKIP_INSTALL:-0}" != "1" ]; then
  log "Installing interop dependencies (hazelcast-client@5.6.0)..."
  cd "$INTEROP_DIR"
  if command -v bun &>/dev/null; then
    bun install 2>&1 | sed 's/^/  /'
  elif command -v npm &>/dev/null; then
    npm install --silent 2>&1 | sed 's/^/  /'
  else
    error "Neither bun nor npm found — cannot install dependencies."
    exit 1
  fi
  cd "$ROOT_DIR"
fi

# ── Step 2: Type-check (non-fatal — warns but does not abort) ─────────────────

log "Running TypeScript type-check on interop package..."
cd "$INTEROP_DIR"
if command -v bun &>/dev/null; then
  bun run tsc --noEmit 2>&1 | sed 's/^/  /' || warn "Type-check reported errors (see above) — continuing."
fi
cd "$ROOT_DIR"

# ── Step 3: Run interop test suites ──────────────────────────────────────────

log "${BOLD}Running official hazelcast-client interop tests${RESET}"
log "Suites: ${SUITES[*]}"
log "Timeout: ${TIMEOUT}ms"
echo ""

PASS_COUNT=0
FAIL_COUNT=0
FAILED_SUITES=()

cd "$INTEROP_DIR"

for suite in "${SUITES[@]}"; do
  SUITE_FILE="suites/${suite}.test.ts"

  if [ ! -f "$SUITE_FILE" ]; then
    warn "Suite file not found: $SUITE_FILE — skipping"
    continue
  fi

  log "Running suite: ${BOLD}${suite}${RESET}"
  if bun test --timeout "$TIMEOUT" "$SUITE_FILE" 2>&1 | sed 's/^/  /'; then
    success "  PASS — ${suite}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    error  "  FAIL — ${suite}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_SUITES+=("$suite")
  fi
  echo ""
done

cd "$ROOT_DIR"

# ── Step 4: Print summary ─────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────────────────────"
echo -e "${BOLD}Interop Test Summary${RESET}"
echo "────────────────────────────────────────────────────────"
echo -e "  Suites run:    $((PASS_COUNT + FAIL_COUNT))"
echo -e "  ${GREEN}Passed:        ${PASS_COUNT}${RESET}"
if [ $FAIL_COUNT -gt 0 ]; then
  echo -e "  ${RED}Failed:        ${FAIL_COUNT}${RESET}"
  echo -e "  ${RED}Failed suites: ${FAILED_SUITES[*]}${RESET}"
fi
echo "────────────────────────────────────────────────────────"

if [ $FAIL_COUNT -gt 0 ]; then
  error "Interop tests FAILED — ${FAIL_COUNT} suite(s) did not pass."
  exit 1
else
  success "All interop test suites passed!"
  exit 0
fi
