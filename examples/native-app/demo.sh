#!/usr/bin/env bash
#
# Helios Near-Cache Demo
#
# Prerequisites: start the two nodes first in separate terminals:
#   Terminal 1:  bun run src/app.ts --name node1 --tcp-port 5701 --http-port 3001
#   Terminal 2:  bun run src/app.ts --name node2 --tcp-port 5702 --http-port 3002 --peer localhost:5701
#
# Then run this script:
#   bash demo.sh
#
set -e

NODE1="http://localhost:3001"
NODE2="http://localhost:3002"

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║        Helios Distributed Near-Cache Demo                ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Health check both nodes ──────────────────────────────────────

echo -e "${CYAN}Step 1: Health check both nodes${NC}"
echo -n "  Node 1: "
curl -s "$NODE1/health" | python3 -m json.tool 2>/dev/null || curl -s "$NODE1/health"
echo ""
echo -n "  Node 2: "
curl -s "$NODE2/health" | python3 -m json.tool 2>/dev/null || curl -s "$NODE2/health"
echo ""
echo ""

# ── Step 2: PUT data on Node 1 ──────────────────────────────────────────

echo -e "${CYAN}Step 2: PUT user data on Node 1${NC}"
echo -e "  ${YELLOW}curl -X PUT $NODE1/map/demo/user1 -d '{\"name\":\"Alice\",\"age\":30}'${NC}"
curl -s -X PUT "$NODE1/map/demo/user1" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Alice","age":30}' | python3 -m json.tool 2>/dev/null || true
echo ""

sleep 0.3  # allow replication

# ── Step 3: GET from Node 2 (first read = near-cache MISS) ──────────────

echo -e "${CYAN}Step 3: GET from Node 2 — first read (expect: near-cache MISS → source: store)${NC}"
echo -e "  ${YELLOW}curl $NODE2/map/demo/user1${NC}"
curl -s "$NODE2/map/demo/user1" | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 4: GET from Node 2 again (second read = near-cache HIT) ────────

echo -e "${CYAN}Step 4: GET from Node 2 — second read (expect: near-cache HIT → source: near-cache)${NC}"
echo -e "  ${YELLOW}curl $NODE2/map/demo/user1${NC}"
curl -s "$NODE2/map/demo/user1" | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 5: Check near-cache stats on Node 2 ────────────────────────────

echo -e "${CYAN}Step 5: Near-cache stats on Node 2 (expect: hits=1, misses=1)${NC}"
echo -e "  ${YELLOW}curl $NODE2/near-cache/demo/stats${NC}"
curl -s "$NODE2/near-cache/demo/stats" | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 6: UPDATE on Node 1 (triggers invalidation on Node 2) ──────────

echo -e "${CYAN}Step 6: UPDATE user on Node 1 (triggers remote INVALIDATE on Node 2)${NC}"
echo -e "  ${YELLOW}curl -X PUT $NODE1/map/demo/user1 -d '{\"name\":\"Alice\",\"age\":31}'${NC}"
curl -s -X PUT "$NODE1/map/demo/user1" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Alice","age":31}' | python3 -m json.tool 2>/dev/null || true
echo ""

sleep 0.3  # allow invalidation to propagate

# ── Step 7: GET from Node 2 (post-invalidation = near-cache MISS again) ─

echo -e "${CYAN}Step 7: GET from Node 2 — after invalidation (expect: MISS → fresh data from store)${NC}"
echo -e "  ${YELLOW}curl $NODE2/map/demo/user1${NC}"
curl -s "$NODE2/map/demo/user1" | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 8: Final near-cache stats ──────────────────────────────────────

echo -e "${CYAN}Step 8: Final near-cache stats on Node 2 (expect: hits=1, misses=2, invalidations>=1)${NC}"
echo -e "  ${YELLOW}curl $NODE2/near-cache/demo/stats${NC}"
curl -s "$NODE2/near-cache/demo/stats" | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 9: List all entries ────────────────────────────────────────────

echo -e "${CYAN}Step 9: List all entries in 'demo' map on both nodes${NC}"
echo "  Node 1:"
curl -s "$NODE1/map/demo" | python3 -m json.tool 2>/dev/null || true
echo "  Node 2:"
curl -s "$NODE2/map/demo" | python3 -m json.tool 2>/dev/null || true
echo ""

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          Predicate Query Demo                            ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Step 10: Seed employee data on Node 1 ───────────────────────────────

echo -e "${CYAN}Step 10: Seed employee data on Node 1${NC}"
for entry in \
  'alice:{"name":"Alice","department":"Engineering","salary":120000,"level":3}' \
  'bob:{"name":"Bob","department":"Marketing","salary":85000,"level":2}' \
  'charlie:{"name":"Charlie","department":"Engineering","salary":140000,"level":4}' \
  'diana:{"name":"Diana","department":"Design","salary":95000,"level":2}' \
  'eve:{"name":"Eve","department":"Engineering","salary":110000,"level":3}' \
  'frank:{"name":"Frank","department":"Marketing","salary":100000,"level":3}'
do
  key="${entry%%:*}"
  data="${entry#*:}"
  echo -e "  ${YELLOW}PUT /map/employees/$key${NC}"
  curl -s -X PUT "$NODE1/map/employees/$key" \
      -H 'Content-Type: application/json' \
      -d "$data" > /dev/null
done
echo "  → 6 employees stored"
echo ""

sleep 0.3

# ── Step 11: Equal predicate — department = Engineering ──────────────────

echo -e "${CYAN}Step 11: Predicate: equal — department = 'Engineering'${NC}"
echo -e "  ${YELLOW}POST /map/employees/query${NC}"
curl -s -X POST "$NODE1/map/employees/query" \
    -H 'Content-Type: application/json' \
    -d '{"predicate":{"equal":{"attribute":"department","value":"Engineering"}}}' \
    | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 12: GreaterThan predicate — salary > 100000 ────────────────────

echo -e "${CYAN}Step 12: Predicate: greaterThan — salary > 100000${NC}"
echo -e "  ${YELLOW}POST /map/employees/query (projection: values)${NC}"
curl -s -X POST "$NODE1/map/employees/query" \
    -H 'Content-Type: application/json' \
    -d '{"predicate":{"greaterThan":{"attribute":"salary","value":100000}},"projection":"values"}' \
    | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 13: Between predicate — salary between 90000 and 120000 ────────

echo -e "${CYAN}Step 13: Predicate: between — salary between 90000 and 120000${NC}"
echo -e "  ${YELLOW}POST /map/employees/query (projection: keys)${NC}"
curl -s -X POST "$NODE1/map/employees/query" \
    -H 'Content-Type: application/json' \
    -d '{"predicate":{"between":{"attribute":"salary","from":90000,"to":120000}},"projection":"keys"}' \
    | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 14: Like predicate — name starts with 'A' or 'C' ──────────────

echo -e "${CYAN}Step 14: Predicate: or + like — name like 'A%' OR name like 'C%'${NC}"
echo -e "  ${YELLOW}POST /map/employees/query${NC}"
curl -s -X POST "$NODE1/map/employees/query" \
    -H 'Content-Type: application/json' \
    -d '{"predicate":{"or":[{"like":{"attribute":"name","expression":"A%"}},{"like":{"attribute":"name","expression":"C%"}}]}}' \
    | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 15: In predicate — department in [Engineering, Design] ─────────

echo -e "${CYAN}Step 15: Predicate: in — department in ['Engineering', 'Design']${NC}"
echo -e "  ${YELLOW}POST /map/employees/query${NC}"
curl -s -X POST "$NODE1/map/employees/query" \
    -H 'Content-Type: application/json' \
    -d '{"predicate":{"in":{"attribute":"department","values":["Engineering","Design"]}}}' \
    | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 16: Compound — Engineering AND salary >= 120000 ────────────────

echo -e "${CYAN}Step 16: Predicate: and — department='Engineering' AND salary >= 120000${NC}"
echo -e "  ${YELLOW}POST /map/employees/query${NC}"
curl -s -X POST "$NODE1/map/employees/query" \
    -H 'Content-Type: application/json' \
    -d '{"predicate":{"and":[{"equal":{"attribute":"department","value":"Engineering"}},{"greaterEqual":{"attribute":"salary","value":120000}}]}}' \
    | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 17: Not predicate — NOT department='Marketing' ─────────────────

echo -e "${CYAN}Step 17: Predicate: not — NOT department='Marketing'${NC}"
echo -e "  ${YELLOW}POST /map/employees/query (projection: keys)${NC}"
curl -s -X POST "$NODE1/map/employees/query" \
    -H 'Content-Type: application/json' \
    -d '{"predicate":{"not":{"equal":{"attribute":"department","value":"Marketing"}}},"projection":"keys"}' \
    | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 18: Regex predicate — name matching ^[A-D].*$ ──────────────────

echo -e "${CYAN}Step 18: Predicate: regex — name matching '^[A-D].*\$'${NC}"
echo -e "  ${YELLOW}POST /map/employees/query${NC}"
curl -s -X POST "$NODE1/map/employees/query" \
    -H 'Content-Type: application/json' \
    -d '{"predicate":{"regex":{"attribute":"name","regex":"^[A-D].*$"}}}' \
    | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 19: Query via GET params — salary > 100000 ─────────────────────

echo -e "${CYAN}Step 19: GET query params — /map/employees/values?attribute=salary&op=greaterThan&value=100000${NC}"
echo -e "  ${YELLOW}GET /map/employees/values?...${NC}"
curl -s "$NODE1/map/employees/values?attribute=salary&op=greaterThan&value=100000" \
    | python3 -m json.tool 2>/dev/null || true
echo ""

# ── Step 20: Query on Node 2 (replicated data) ─────────────────────────

echo -e "${CYAN}Step 20: Same query on Node 2 — verifies replicated data is queryable${NC}"
echo -e "  ${YELLOW}POST $NODE2/map/employees/query${NC}"
curl -s -X POST "$NODE2/map/employees/query" \
    -H 'Content-Type: application/json' \
    -d '{"predicate":{"greaterEqual":{"attribute":"salary","value":100000}},"projection":"values"}' \
    | python3 -m json.tool 2>/dev/null || true
echo ""

echo -e "${GREEN}${BOLD}Demo complete!${NC}"
echo ""
echo "What happened:"
echo "  Near-cache:"
echo "  1. Data was PUT on Node 1 → replicated to Node 2 via TCP"
echo "  2. First GET on Node 2 → near-cache MISS (fetched from replicated store)"
echo "  3. Second GET on Node 2 → near-cache HIT (served from local cache)"
echo "  4. UPDATE on Node 1 → INVALIDATE message sent to Node 2 via TCP"
echo "  5. Next GET on Node 2 → near-cache MISS (cache was invalidated, re-fetched fresh data)"
echo ""
echo "  Predicate queries:"
echo "  6. equal, greaterThan, between, like, in, regex, and, or, not predicates"
echo "  7. JSON DSL (POST /map/:name/query) and query params (GET /map/:name/values?...)"
echo "  8. Queries work identically on both nodes (data fully replicated)"
echo ""
