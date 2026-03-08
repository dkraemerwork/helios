# Block K — Official hazelcast-client Interop Tests

This directory contains acceptance tests that use the **official `hazelcast-client` npm package** (v5.6.0) as the final judge of Helios wire compatibility.

Every test in this directory connects to a real Helios server instance using the same client library that production Hazelcast users deploy. If these tests pass, Helios is provably compatible with the official Hazelcast Node.js client.

---

## What These Tests Prove

| Suite | What Is Verified |
|-------|-----------------|
| `connection` | Client connects, discovers members, handles auth failure and timeout |
| `map` | Full IMap API: CRUD, TTL, entry listeners, keySet/values/entrySet, putAll, getAll |
| `queue` | IQueue: offer, poll, peek, size, isEmpty, clear, FIFO order, blocking poll |
| `topic` | ITopic: publish, subscribe, multiple listeners, removeListener |
| `collections` | IList + ISet: add, get, remove, contains, size, clear |
| `multimap` | MultiMap: put, get, remove, containsKey, size, keySet, values |
| `replicatedmap` | ReplicatedMap: put, get, remove, size, containsKey, containsValue |
| `atomics` | AtomicLong + AtomicReference via CP subsystem: CAS, increment, decrement |
| `flakeid` | FlakeIdGenerator: unique ID generation, bulk uniqueness |
| `pncounter` | PNCounter CRDT: addAndGet, subtractAndGet, getAndAdd, getAndSubtract |
| `lifecycle` | Client shutdown, reconnect cycles, lifecycle listeners, server-side disconnect |

---

## Architecture

```
test/interop/
├── package.json              # Workspace package — hazelcast-client@5.6.0 devDependency
├── tsconfig.json             # TypeScript config for the interop workspace
├── run-interop.sh            # CI entry point — installs deps, runs tests, exits with result
├── README.md                 # This file
├── helpers/
│   └── HeliosTestCluster.ts  # Starts 1 or 3 Helios members programmatically
│                             # Returns host:port info for the official client
└── suites/
    ├── connection.test.ts
    ├── map.test.ts
    ├── queue.test.ts
    ├── topic.test.ts
    ├── collections.test.ts
    ├── multimap.test.ts
    ├── replicatedmap.test.ts
    ├── atomics.test.ts
    ├── flakeid.test.ts
    ├── pncounter.test.ts
    └── lifecycle.test.ts
```

### HeliosTestCluster

`HeliosTestCluster` starts Helios instances **in-process** using the same `HeliosInstanceImpl` the rest of the test suite uses, with the client protocol server enabled on ephemeral ports. Each test suite creates an isolated cluster with a unique name so suites can run concurrently without interference.

```typescript
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

const cluster = new HeliosTestCluster("my-test-cluster");
const { clusterName, addresses } = await cluster.startSingle();

// addresses is ["127.0.0.1:<ephemeral-port>"]
const hzClient = await Client.newHazelcastClient({
  clusterName,
  network: { clusterMembers: addresses },
});

// ... run tests ...

await hzClient.shutdown();
await cluster.shutdown();
```

---

## Running the Tests

### Prerequisites

- Bun ≥ 1.1.0 installed
- Node.js ≥ 18 (for `hazelcast-client` native bindings)

### Install dependencies

```bash
cd test/interop
bun install
```

### Run all suites

```bash
# From the repo root
./test/interop/run-interop.sh

# Or from within the interop directory
bun test --timeout 60000 suites/
```

### Run a specific suite

```bash
# Via the run script
./test/interop/run-interop.sh map

# Or directly with bun
cd test/interop
bun test --timeout 60000 suites/map.test.ts

# Multiple suites
./test/interop/run-interop.sh connection map lifecycle
```

### Skip dependency install (CI with cached node_modules)

```bash
INTEROP_SKIP_INSTALL=1 ./test/interop/run-interop.sh
```

### Custom timeout

```bash
INTEROP_TIMEOUT=120000 ./test/interop/run-interop.sh
```

---

## CI Integration

Add this step to your CI pipeline after building Helios:

```yaml
- name: Run official hazelcast-client interop tests
  run: ./test/interop/run-interop.sh
```

The script exits with code `0` on success and `1` on any failure. Individual suite results are printed with clear PASS/FAIL labels, and a summary is printed at the end.

---

## Adding New Tests

1. Create `test/interop/suites/<name>.test.ts`
2. Import from `hazelcast-client` (the official package) and `bun:test`
3. Use `HeliosTestCluster` in `beforeEach`/`afterEach` for isolation
4. Add the suite name to `run-interop.sh`'s `ALL_SUITES` array
5. Add a script alias to `package.json`

### Template

```typescript
import { Client } from "hazelcast-client";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeliosTestCluster } from "../helpers/HeliosTestCluster";

describe("Official Client — MyFeature", () => {
  let cluster: HeliosTestCluster;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>>;

  beforeEach(async () => {
    cluster = new HeliosTestCluster();
    const { clusterName, addresses } = await cluster.startSingle();
    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });
  });

  afterEach(async () => {
    try { await hzClient.shutdown(); } catch { /* ignore */ }
    await cluster.shutdown();
  });

  it("does what it should", async () => {
    // Test using OFFICIAL hazelcast-client API
    const map = await hzClient.getMap("my-map");
    await map.put("key", "value");
    expect(await map.get("key")).toBe("value");
  });
});
```

---

## Troubleshooting

### `ClientProtocolServer did not start`

The Helios server's client protocol server must be enabled. `HeliosTestCluster` configures this automatically (`setClientProtocolPort(0)` for ephemeral port selection). If you see this error, check that your Helios build includes the client protocol server and that `HeliosInstanceImpl.getClientProtocolPort()` returns a positive port.

### `Cannot find module 'hazelcast-client'`

Run `bun install` in `test/interop/` first.

### Auth failure / wrong cluster name

The cluster name used in `Client.newHazelcastClient({ clusterName })` must exactly match the name used when creating the `HeliosTestCluster`. `HeliosTestCluster` generates a unique cluster name per instance — always use `cluster.getConnectionInfo().clusterName` rather than a hard-coded string.

### Timeout errors

Increase the timeout via `INTEROP_TIMEOUT=120000` or `--timeout 120000`. Some CP subsystem tests (AtomicLong, AtomicReference) may be slower when the CP subsystem is not pre-warmed.
