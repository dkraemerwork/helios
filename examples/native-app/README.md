# Native App Demo

This demo starts three Helios members with:

- built-in REST endpoints for maps and queues
- a small control API for publishing to demo topics and inspecting received messages
- a Hazelcast-inspired management center at `/management`

## Start the cluster

```bash
docker compose up --build
```

## Run the walkthrough

```bash
bash demo.sh
```

## Endpoints

- REST nodes: `http://localhost:8081`, `http://localhost:8082`, `http://localhost:8083`
- Control nodes: `http://localhost:9091`, `http://localhost:9092`, `http://localhost:9093`
- Management center: `http://localhost:9091/management` (also available on `9092` and `9093`)

Examples:

```bash
curl http://localhost:8081/hazelcast/rest/cluster
curl -X POST http://localhost:8082/hazelcast/rest/queues/jobs -H 'Content-Type: application/json' -d '{"id":"job-1"}'
curl http://localhost:8083/hazelcast/rest/queues/jobs/1

curl -X POST http://localhost:9091/demo/topics/demo-events/publish \
  -H 'Content-Type: application/json' \
  -d '{"message":"hello"}'
curl http://localhost:9092/demo/topics/demo-events/messages
```
