# Helios documentation

| Document | Purpose |
| -------- | ------- |
| **[PARITY_MATRIX.md](./PARITY_MATRIX.md)** | **Authoritative** in-scope Hazelcast OSS feature parity (COMPLETE / EXCLUDED). Use this for status claims. |
| [baseline/FEATURE_INVENTORY.md](./baseline/FEATURE_INVENTORY.md) | Historical March 2026 feature audit — **superseded** by the parity matrix |
| [baseline/OPCODE_INVENTORY.md](./baseline/OPCODE_INVENTORY.md) | Client-protocol opcode inventory — **partially stale**; prefer code + matrix for product claims |
| [baseline/DEFAULTS_INVENTORY.md](./baseline/DEFAULTS_INVENTORY.md) | Config defaults reference |
| [plans/](./plans/) | Historical planning notes |

Root project overview, quick start, and testing: **[../README.md](../README.md)**.

## Exceptions (by design)

1. **Concurrency** — Node/Bun async (not Java threads).
2. **Streaming** — Blitz + `nats-server` (not a Hazelcast Jet engine port).
