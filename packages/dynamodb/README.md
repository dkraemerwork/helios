# `@zenystx/helios-dynamodb`

**DynamoDB-Compatible MapStore for Helios**

DynamoDB-compatible MapStore adapter for Helios IMap persistence. Scylla/Alternator is the first production-proof provider.

---

## Installation

```bash
bun add @zenystx/helios-dynamodb
```

---

## Quick Start

```typescript
import { DynamoDbMapStore } from '@zenystx/helios-dynamodb';
import { HeliosConfig, MapConfig, MapStoreConfig } from '@zenystx/helios-core';

const store = new DynamoDbMapStore({
  endpoint: 'http://your-scylla-alternator:8000',
  credentials: { accessKeyId: '...', secretAccessKey: '...' },
  region: 'us-east-1',
  bucketCount: 64,
});

const mapStoreConfig = new MapStoreConfig()
  .setEnabled(true)
  .setImplementation(store)
  .setWriteDelaySeconds(5); // write-behind mode

const mapCfg = new MapConfig();
mapCfg.setMapStoreConfig(mapStoreConfig);

const cfg = new HeliosConfig();
cfg.addMapConfig('persistent-map', mapCfg);
```

---

## Table Schema

The adapter uses a **bucketed partition design** to distribute entries across a bounded number of partitions, avoiding hot-partition problems on large maps.

| Column        | Type | Role          | Description                                      |
| ------------- | ---- | ------------- | ------------------------------------------------ |
| `bucket_key`  | S    | Partition key | Format: `<mapName>#<bucketNumber>`               |
| `entry_key`   | S    | Sort key      | The original map key                             |
| `entry_value` | S    | Attribute     | Serialized value (JSON by default)               |
| `updated_at`  | N    | Attribute     | Epoch milliseconds timestamp of the last write   |

- **Default table name:** `helios_mapstore`
- **Bucket count:** 64 (configurable via `bucketCount`)
- Keys are deterministically assigned to buckets via a DJB2 hash of the key string.
- One shared table serves all maps — the map name is encoded in the `bucket_key` prefix.

---

## Configuration Reference

All fields on `DynamoDbConfig`:

| Field              | Type                                        | Default              | Description                                                                 |
| ------------------ | ------------------------------------------- | -------------------- | --------------------------------------------------------------------------- |
| `endpoint`         | `string`                                    | —                    | Single endpoint URL, e.g. `http://localhost:8000`                           |
| `endpoints`        | `string[]`                                  | —                    | Multiple endpoints for a DynamoDB-compatible cluster                        |
| `endpointStrategy` | `'single' \| 'round-robin'`                 | `'single'`           | Endpoint selection strategy when `endpoints` is provided                    |
| `region`           | `string`                                    | `'us-east-1'`        | Region passed to the AWS SDK signer                                         |
| `credentials`      | `{ accessKeyId, secretAccessKey }`          | —                    | Access key credentials for the backing service                              |
| `tableName`        | `string`                                    | `'helios_mapstore'`  | Shared table name                                                           |
| `bucketCount`      | `number`                                    | `64`                 | Number of deterministic key buckets per map                                 |
| `autoCreateTable`  | `boolean`                                   | `true`               | Create the backing table during `init()` if it does not exist               |
| `consistentRead`   | `boolean`                                   | `false`              | Use strongly consistent reads for get/load paths when supported             |
| `serializer`       | `Serializer<T>`                             | JSON stringify/parse | Custom serializer for values                                                |
| `requestTimeoutMs` | `number`                                    | `5000`               | Request timeout in milliseconds for individual DynamoDB operations          |
| `maxRetries`       | `number`                                    | `10`                 | Maximum retry attempts for batch operations with unprocessed items          |
| `retryBaseDelayMs` | `number`                                    | `100`                | Base delay in milliseconds for exponential backoff between retries          |
| `retryMaxDelayMs`  | `number`                                    | `5000`               | Maximum delay in milliseconds for exponential backoff                       |
| `tls`              | `TlsConfig`                                 | —                    | TLS configuration for secure connections                                    |
| `requestHandler`   | `unknown`                                   | —                    | Custom request handler for advanced transport configuration (TLS, proxies)  |
| `metrics`          | `DynamoDbMapStoreMetrics`                   | —                    | Optional metrics listener for observability                                 |

---

## Write Modes

Helios MapStore supports two persistence modes, configured via `MapStoreConfig.setWriteDelaySeconds()`:

### Write-Through (`writeDelaySeconds = 0`)

Every `map.put()` blocks until the external write completes. Guarantees data is persisted before the caller returns, at the cost of increased put latency.

### Write-Behind (`writeDelaySeconds > 0`)

Writes are buffered in memory and flushed to DynamoDB in batches on a timer. This smooths latency spikes and reduces the number of external calls under high write throughput.

**Recommendation:** Use write-behind (`writeDelaySeconds = 5` is a good starting point) for production workloads. Write-through is appropriate when you need synchronous persistence guarantees and can tolerate the added latency per put.

---

## Production Notes

- **Write-behind is recommended** for latency smoothing under sustained write loads.
- Persistence is **at-least-once** at the adapter boundary — duplicate writes are possible on retries.
- `clear()` is **expensive** on large maps — it performs a full bucket sweep (one query + batch delete per bucket).
- `loadAllKeys()` is **streaming** (async generator, no buffered accumulation) but operationally heavy — it queries every bucket sequentially.
- `bucketCount` is **immutable per persisted map** in v1 — changing it after data has been written will orphan entries in the old bucket range.
- **Scylla/Alternator is the only v1 production-proof provider.** The adapter targets the DynamoDB API surface, but only Scylla/Alternator has been validated end-to-end.

---

## TLS / Custom CA

For endpoints behind TLS with a custom certificate authority, pass a custom `requestHandler` from the AWS SDK:

```typescript
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'node:https';

const store = new DynamoDbMapStore({
  endpoint: 'https://your-scylla-alternator:8043',
  credentials: { accessKeyId: '...', secretAccessKey: '...' },
  requestHandler: new NodeHttpHandler({
    httpsAgent: new https.Agent({
      ca: fs.readFileSync('/path/to/custom-ca.pem'),
      rejectUnauthorized: true,
    }),
  }),
});
```

The `tls` config field is also available for simpler cases:

```typescript
const store = new DynamoDbMapStore({
  endpoint: 'https://your-scylla-alternator:8043',
  credentials: { accessKeyId: '...', secretAccessKey: '...' },
  tls: {
    enabled: true,
    ca: fs.readFileSync('/path/to/custom-ca.pem', 'utf-8'),
    rejectUnauthorized: true,
  },
});
```

---

## Observability

The `DynamoDbMapStoreMetrics` interface allows you to receive operational signals from the adapter:

| Callback              | Fires on                                                    |
| --------------------- | ----------------------------------------------------------- |
| `onOperation`         | Successful single-item operation (store, delete, load)      |
| `onBatchOperation`    | Successful batch operation (storeAll, deleteAll, loadAll, clear) |
| `onRetry`             | Batch retry due to unprocessed items                        |
| `onRetryExhausted`    | All retries exhausted — operation failed                    |
| `onError`             | Any DynamoDB transport/timeout error                        |
| `onKeyStreamProgress` | Progress during `loadAllKeys()` streaming (per bucket)      |

Pass an implementation via the `metrics` config field:

```typescript
const store = new DynamoDbMapStore({
  endpoint: 'http://localhost:8000',
  credentials: { accessKeyId: '...', secretAccessKey: '...' },
  metrics: {
    onOperation(op, durationMs) {
      console.log(`${op} completed in ${durationMs}ms`);
    },
    onRetry(op, attempt, unprocessed) {
      console.warn(`${op} retry #${attempt}, ${unprocessed} unprocessed`);
    },
    onError(op, error) {
      console.error(`${op} failed:`, error.message);
    },
  },
});
```

---

## Known Limitations

- **No exactly-once persistence** — at-least-once semantics at the adapter boundary.
- **No partial updates** — each `store()` writes the full serialized value.
- **No CAS (compare-and-swap)** — conditional writes are not supported.
- **String keys only** — map keys must be strings (no composite key support).
- **No split-brain merge correctness** — convergence relies on last-writer-wins via `updated_at`.
- **`bucketCount` immutability** is trust-based in v1 — no persisted metadata enforcement.

---

## License

Apache 2.0
