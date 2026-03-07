#!/usr/bin/env bash

set -euo pipefail

NODE1_REST="http://localhost:8081"
NODE2_REST="http://localhost:8082"
NODE3_REST="http://localhost:8083"

NODE1_CTRL="http://localhost:9091"
NODE2_CTRL="http://localhost:9092"
NODE3_CTRL="http://localhost:9093"

pretty_print() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool 2>/dev/null || cat
  else
    cat
  fi
}

step() {
  printf '\n== %s ==\n' "$1"
}

step "Cluster view on all three nodes"
for url in "$NODE1_CTRL" "$NODE2_CTRL" "$NODE3_CTRL"; do
  printf '\n%s/demo/cluster\n' "$url"
  curl -s "$url/demo/cluster" | pretty_print
done

step "Map write on node1, read from node3"
curl -s -X POST "$NODE1_REST/hazelcast/rest/maps/demo/user1" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice","role":"admin"}' >/dev/null
sleep 0.5
curl -s "$NODE3_REST/hazelcast/rest/maps/demo/user1" | pretty_print

step "Queue offer on node2, poll from node1"
curl -s -X POST "$NODE2_REST/hazelcast/rest/queues/jobs" \
  -H 'Content-Type: application/json' \
  -d '{"id":"job-1","kind":"email"}' | pretty_print
sleep 0.5
curl -s "$NODE1_REST/hazelcast/rest/queues/jobs/1" | pretty_print

step "Topic publish on node1, inspect what node2 and node3 observed"
curl -s -X POST "$NODE1_CTRL/demo/topics/demo-events/publish" \
  -H 'Content-Type: application/json' \
  -d '{"from":"node1","message":"hello cluster"}' | pretty_print
sleep 0.5
curl -s "$NODE2_CTRL/demo/topics/demo-events/messages" | pretty_print
curl -s "$NODE3_CTRL/demo/topics/demo-events/messages" | pretty_print

step "Blitz quote streaming — check ingestor status (node1 is the default ingestor)"
curl -s "$NODE1_CTRL/blitz/quotes/status" | pretty_print

step "Start printing quotes on node2"
curl -s -X POST "$NODE2_CTRL/blitz/quotes/print/start" | pretty_print
printf '\nWaiting 5 seconds to collect quotes...\n'
sleep 5

step "Check recent quotes received on node2"
curl -s "$NODE2_CTRL/blitz/quotes/recent" | pretty_print

step "Stop printing quotes on node2"
curl -s -X POST "$NODE2_CTRL/blitz/quotes/print/stop" | pretty_print

step "Done"
printf 'Use the REST ports (8081-8083) for maps/queues and control ports (9091-9093) for topic/quote endpoints.\n'
printf '\nBlitz quote endpoints (on each node control port):\n'
printf '  GET  /blitz/quotes/status          — Ingestor + subscriber status\n'
printf '  GET  /blitz/quotes/recent          — Recent quotes received\n'
printf '  POST /blitz/quotes/ingest/start    — Start Binance WS ingestion\n'
printf '  POST /blitz/quotes/ingest/stop     — Stop Binance WS ingestion\n'
printf '  POST /blitz/quotes/print/start     — Start printing quotes to console\n'
printf '  POST /blitz/quotes/print/stop      — Stop printing quotes\n'
printf '\nFailover test: kill a container with "docker kill helios-native-demo-node1-1"\n'
printf 'Then start ingestion on another node: curl -X POST localhost:9092/blitz/quotes/ingest/start\n'
