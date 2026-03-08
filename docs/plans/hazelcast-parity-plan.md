# Helios Performance Plan: Achieving Hazelcast Parity (and Beyond)

**Version:** 1.0
**Date:** 2026-03-08
**Status:** Draft
**Author:** Helios Core Team

---

## Table of Contents

1. [Context](#context)
2. [Goal](#goal)
3. [Research Summary](#research-summary)
4. [Current State Assessment](#current-state-assessment)
5. [Phase 1: Zero-Risk Quick Wins](#phase-1-zero-risk-quick-wins-2-3-hours)
6. [Phase 2: Binary Wire Protocol](#phase-2-binary-wire-protocol-6-10-hours)
7. [Phase 3: Buffer Pooling & Allocation Reduction](#phase-3-buffer-pooling--allocation-reduction-3-5-hours)
8. [Phase 4: Outbound Batching](#phase-4-outbound-batching-3-4-hours)
9. [Phase 5: Scatter Worker Integration](#phase-5-scatter-worker-integration-4-6-hours)
10. [Phase 6: Advanced Optimizations](#phase-6-advanced-optimizations-future)
11. [Cumulative Impact Summary](#cumulative-impact-summary)
12. [Appendix: Key Source Files Reference](#appendix-key-source-files-reference)

---

## Context

Helios is an open-source distributed in-memory data grid written in TypeScript, running on Bun. It aims to be a native TypeScript equivalent of Hazelcast — providing IMap, distributed executors, partitioned data, near-cache, and cluster discovery. The codebase lives at `/Users/zenystx/IdeaProjects/helios`.

We have spent extensive sessions stress-testing a 4-node cluster (3 servers + 1 client) and reached **41.7k ops/s with 0 errors** using the current JSON-based wire protocol. Along the way we fixed critical transport bugs (phantom backpressure, message loss, multicast discovery, pipe deadlock). We researched Hazelcast's full NIO architecture in depth and benchmarked `@zenystx/scatterjs` scatter worker channels for serialization offloading.

**What we already fixed:**

- EventloopChannel phantom backpressure (check `socket.write` return value)
- EventloopChannel unbounded write queue (matching Hazelcast's `ConcurrentLinkedQueue`)
- Outbound buffer 4MB
- Multicast discovery (4 bugs)
- `Transport.send()` returns boolean for fail-fast
- All tests pass: **4776 pass, 15 skip, 0 fail**

---

## Goal

**Make Helios's internal operation processing pipeline faster than Hazelcast.** Leverage Bun's native advantages (single-binary runtime, fast I/O, no JVM warmup/GC pauses, efficient memory model) while implementing the architectural patterns that make Hazelcast fast — but adapted for a single-threaded event loop + scatter worker model instead of Java's multi-threaded NIO.

**Target:** 150k+ ops/s on 4-node cluster (3.6x current), approaching or exceeding Hazelcast's per-node throughput of ~50k ops/s/node.

---

## Research Summary

### Serialization Microbenchmarks (417-byte JSON payload)

| Step | ns/op |
|------|------:|
| `JSON.stringify(msg)` | 236 ns |
| `JSON.parse(msg)` | 355 ns |
| `Buffer.from(str, 'utf8')` | 187 ns |
| `TextEncoder.encode(str)` | 79 ns |
| base64 encode (50B key) | 45 ns |
| base64 decode (50B key) | 99 ns |
| base64 encode (120B value) | 54 ns |
| base64 decode (120B value) | 147 ns |
| Full send: stringify + `Buffer.from` | 325 ns |
| Full send: stringify + `TextEncoder` | 213 ns |
| Full recv: `buf.toString` + `JSON.parse` | 426 ns |
| Length prefix frame construction | 171 ns |
| **SYNC baseline (stringify+encode+frame)** | **783 ns** |

### Scatter Channel Benchmarks

| Test | ns/op | vs Sync |
|------|------:|---------|
| Sync baseline (stringify+encode+frame) | 783 ns | 1.00x |
| Raw ring buffer push only (raw codec) | 265 ns | 0.34x |
| JSON codec push (main->ring, one-way) | 846 ns | 1.08x |
| E2E single worker (push + readAsync drain) | 3,100 ns | 3.91x |
| E2E 2 workers parallel | 1,600 ns | 2.07x |
| E2E 4 workers parallel | 2,300 ns | 2.92x |

**Key insight:** Raw ring buffer push is blazing fast (265ns). But JSON codec forces `JSON.stringify` on main thread to enter the channel — defeating the purpose. `readAsync()` microtask scheduling adds ~1-3us per resolution, killing E2E latency. Scatter channels only win when: (1) offloaded work > crossing cost, and (2) fire-and-forget push (no round-trip).

### Current Helios Hot Path — 8-10 Data Copies Per Round-Trip

**SEND path** (IMap.set() to wire):

```
1. JS Object -> toData() -> Buffer(HeapData)           [serialize]
2. bytes.toString('base64') -> string                   [+33% bloat, per Data field]
3. Embedded in JS ClusterMessage object                 [wrap]
4. JSON.stringify(message) -> JSON string               [encode #2]
5. Buffer.from(jsonStr, 'utf8') -> Buffer               [encode #3]
6. Buffer.allocUnsafe(4+len) + payload.copy()           [copy #4]
7. socket.write(frame)                                  [syscall]
```

**RECEIVE path** (wire to op execution):

```
1. Buffer.from(incoming)                                [copy #1]
2. Buffer.concat([old, new])                            [copy #2, O(n^2)!!!]
3. buffer.toString('utf8') -> string                    [decode #1]
4. JSON.parse() -> object                               [decode #2]
5. Buffer.from(base64str, 'base64')                     [decode #3, per field]
6. new HeapData(buffer)                                 [wrap]
7. op.run()                                             [execute]
```

**Wire overhead:** ~4.8x (260 bytes on wire for 54 bytes of actual data)

### Hazelcast Hot Path — 1-2 Copies Per Round-Trip

**SEND:**

```
1. Java Object -> toData() -> byte[] (HeapData)        [serialize, binary, POOLED buffer]
2. Packet wraps byte[] (IS-A HeapData)                  [ZERO-COPY wrap]
3. PacketEncoder: 11B header + payload -> ByteBuffer    [single encode, BATCHED]
4. socketChannel.write(ByteBuffer)                      [single syscall]
```

**RECEIVE:**

```
1. socketChannel.read(ByteBuffer)                       [syscall into PRE-ALLOCATED buffer]
2. PacketDecoder: stateful partial read                 [ZERO concat, resumes in-place]
3. new Packet(byte[]) wraps payload                     [single alloc]
4. toObject(packet) -> Operation                        [binary deserialize, POOLED buffer]
5. op.run()                                             [execute]
```

**Wire overhead:** ~1.5x (80 bytes for 54 bytes of data)

### Hazelcast Binary Wire Frame Format

```
+----------+-------+--------------+--------------+-----------------+
| VERSION  | FLAGS | PARTITION_ID | PAYLOAD_SIZE | PAYLOAD...      |
| 1 byte   | 2 B   | 4 bytes      | 4 bytes      | N bytes         |
+----------+-------+--------------+--------------+-----------------+
                    HEADER_SIZE = 11 bytes
```

HeapData layout (inside payload):

```
+----------------+----------+--------------------+
| PARTITION_HASH | TYPE_ID  | SERIALIZED_DATA    |
| 4 bytes        | 4 bytes  | N bytes            |
+----------------+----------+--------------------+
                  OVERHEAD = 8 bytes
```

Operation binary encoding (inside serialized data):

```
+----------+------------+----------+
| IDS_FLAG | FACTORY_ID | CLASS_ID |
| 1 byte   | 4 bytes    | 4 bytes  |
+----------+------------+----------+
+---------+-------+--------------+------------------+---------------+--------------+
| CALL_ID | FLAGS | PARTITION_ID | INVOCATION_TIME  | CALL_TIMEOUT  | CALLER_UUID  |
| 8 bytes | 2 B   | 2-4 bytes    | 8 bytes          | 4-8 bytes     | 16B if set   |
+---------+-------+--------------+------------------+---------------+--------------+
+-----------------------------------+
| ...operation-specific fields...   |
+-----------------------------------+
```

### Current Bottlenecks (Ranked by Impact)

| # | Bottleneck | Impact | Location |
|---|-----------|--------|----------|
| 1 | `Buffer.concat` on every TCP event — O(n^2) | Critical | `TcpClusterTransport.ts:243` |
| 2 | Base64 encode/decode of Data fields — +33% wire bloat | Critical | `OperationWireCodec.ts:30-37` |
| 3 | `JSON.stringify`/`parse` of entire message — 600ns/op + huge strings | High | `SerializationStrategy.ts:22-28` |
| 4 | `setTimeout` per operation — never cancelled, 500K timers at 50K/s | High | `HeliosInstanceImpl.ts:571` |
| 5 | 4 Promises + 7 closures per operation — massive GC pressure | Medium | Multiple files |
| 6 | Frame alloc + copy (`Buffer.allocUnsafe` + `payload.copy`) | Medium | `TcpClusterTransport.ts:217-219` |
| 7 | Redundant key serialization in `MapProxy.set()` | Medium | `MapProxy.ts:204-206` |
| 8 | O(members) scan in `_findMemberIdByAddress()` per op | Low | `HeliosInstanceImpl.ts:900-909` |

---

## Phase 1: Zero-Risk Quick Wins (2-3 hours)

### Objective

Eliminate low-hanging performance bottlenecks without changing the wire protocol or overall architecture. Each change is independently safe, independently testable, and independently deployable. Combined, these should yield a **25-40% throughput improvement**.

### Dependencies

None. This phase can start immediately. Each item within the phase is also independent.

### Risk Level: Low

All changes are localized, behavior-preserving, and covered by existing tests.

---

### 1.1 Replace `Buffer.from(str, 'utf8')` with `TextEncoder.encode()`

**File:** `src/cluster/tcp/SerializationStrategy.ts`
**Lines:** ~22-28 (the `serialize()` method of `JsonSerializationStrategy`)

**Current code pattern:**
```typescript
const jsonStr = JSON.stringify(message);
const buf = Buffer.from(jsonStr, 'utf8');
```

**New code pattern:**
```typescript
const encoder = new TextEncoder(); // module-level singleton
const jsonStr = JSON.stringify(message);
const buf = encoder.encode(jsonStr);
```

**Expected improvement:** 187ns -> 79ns per encode = **108ns saved per operation** (14% of the 783ns sync baseline).

**Risk:** Low. `TextEncoder.encode()` returns `Uint8Array` which is compatible with `socket.write()` in Bun. Verify that downstream code does not depend on `Buffer`-specific methods (`.copy()`, `.readUInt32BE()`, etc.) on this particular value — if it does, use `Buffer.from(encoder.encode(jsonStr))` which still avoids the UTF-8 scanning overhead.

**Test strategy:**
- Run full test suite: `bun test` (4776 tests must pass)
- Microbenchmark: time `TextEncoder.encode()` vs `Buffer.from()` for the 417B payload to confirm the 108ns improvement
- Integration: run 4-node stress test, verify ops/s improves and 0 errors

**Rollback:** Revert the single line change.

---

### 1.2 Replace `Buffer.concat` with Stateful Frame Decoder

**File:** `src/cluster/tcp/TcpClusterTransport.ts`
**Lines:** ~243 (inside `_onData()`)

**Current code pattern:**
```typescript
_onData(data: Buffer) {
    this._buffer = Buffer.concat([this._buffer, data]);
    while (this._buffer.length >= 4) {
        const len = this._buffer.readUInt32BE(0);
        if (this._buffer.length < 4 + len) break;
        const frame = this._buffer.subarray(4, 4 + len);
        this._buffer = this._buffer.subarray(4 + len);
        this._onFrame(frame);
    }
}
```

**Problem:** `Buffer.concat` allocates a new buffer and copies ALL accumulated bytes on EVERY TCP data event. At 50k ops/s with ~260 bytes/op, this means ~13MB/s of redundant copies, and the cost is O(n^2) when messages arrive faster than they're consumed.

**New code pattern — Stateful decoder with pre-allocated read buffer:**
```typescript
// Module-level or instance-level state
private _readBuffer: Buffer = Buffer.allocUnsafe(64 * 1024); // 64KB initial
private _readOffset: number = 0;  // write cursor
private _readConsumed: number = 0; // read cursor

_onData(data: Buffer) {
    // Ensure capacity
    const needed = this._readOffset + data.length;
    if (needed > this._readBuffer.length) {
        // Grow: allocate 2x, copy only unconsumed data
        const unconsumed = this._readOffset - this._readConsumed;
        const newSize = Math.max(this._readBuffer.length * 2, unconsumed + data.length);
        const newBuf = Buffer.allocUnsafe(newSize);
        this._readBuffer.copy(newBuf, 0, this._readConsumed, this._readOffset);
        this._readBuffer = newBuf;
        this._readOffset = unconsumed;
        this._readConsumed = 0;
    } else if (this._readConsumed > 0 && this._readConsumed > this._readBuffer.length / 2) {
        // Compact: shift unconsumed data to start when > 50% wasted
        const unconsumed = this._readOffset - this._readConsumed;
        this._readBuffer.copy(this._readBuffer, 0, this._readConsumed, this._readOffset);
        this._readOffset = unconsumed;
        this._readConsumed = 0;
    }

    // Append incoming data (single copy)
    data.copy(this._readBuffer, this._readOffset);
    this._readOffset += data.length;

    // Parse frames
    while (this._readOffset - this._readConsumed >= 4) {
        const len = this._readBuffer.readUInt32BE(this._readConsumed);
        if (this._readOffset - this._readConsumed < 4 + len) break;
        // subarray is zero-copy — it creates a view, not a copy
        const frame = this._readBuffer.subarray(this._readConsumed + 4, this._readConsumed + 4 + len);
        this._readConsumed += 4 + len;
        this._onFrame(frame);
    }
}
```

**Expected improvement:** Eliminates O(n^2) `Buffer.concat`. At steady state (no grows/compacts), the only copy is `data.copy()` which is the incoming TCP data — unavoidable. This saves **~200-400ns per operation** at moderate load, and prevents catastrophic degradation under burst traffic where the old path could reach **microseconds** per concat.

**Risk:** Low-Medium. The stateful decoder is a well-understood pattern. Edge cases to verify:
- Partial frame spanning multiple `_onData` calls
- Multiple complete frames in a single `_onData` call
- Zero-length data event
- Very large single frame (> 64KB initial buffer)

**Test strategy:**
- Unit test the decoder with: single frame, multiple frames in one chunk, split frame across chunks, oversized frame
- Full test suite: `bun test`
- Stress test: 4-node cluster at 50k+ ops/s with varying payload sizes

**Rollback:** Revert to `Buffer.concat` pattern. The interface (`_onFrame(frame)`) is unchanged.

---

### 1.3 Replace Per-Operation `setTimeout` with Invocation Sweeper Timer

**File:** `src/instance/impl/HeliosInstanceImpl.ts`
**Lines:** ~571 (where `setTimeout` is called per `remoteSend`)

**Current code pattern:**
```typescript
// Per operation:
const timer = setTimeout(() => {
    this._pendingResponses.delete(callId);
    reject(new OperationTimeoutError(...));
}, timeoutMs);
```

At 50k ops/s with a 10-second timeout, this creates **500,000 concurrent timers** in the runtime. Each timer is a heap-allocated object that the event loop must track and GC must scan.

**New code pattern — Single sweeper interval:**
```typescript
// In constructor or init:
private _invocationSweepInterval: Timer;
private _invocationTimeoutMs: number = 120_000; // default

init() {
    // Sweep every 1 second
    this._invocationSweepInterval = setInterval(() => {
        this._sweepInvocations();
    }, 1000);
}

_sweepInvocations() {
    const now = Date.now();
    for (const [callId, entry] of this._pendingResponses) {
        if (now - entry.createdAt > this._invocationTimeoutMs) {
            this._pendingResponses.delete(callId);
            entry.reject(new OperationTimeoutError(...));
        }
    }
}

// In remoteSend — store createdAt instead of creating timer:
remoteSend(op, partitionId) {
    const callId = this._nextCallId();
    const entry = {
        resolve,
        reject,
        createdAt: Date.now(),
        // no setTimeout!
    };
    this._pendingResponses.set(callId, entry);
}

// On successful response — just delete, no clearTimeout:
_handleResponse(callId, result) {
    const entry = this._pendingResponses.get(callId);
    if (entry) {
        this._pendingResponses.delete(callId);
        entry.resolve(result);
        // no clearTimeout needed!
    }
}
```

**Expected improvement:**
- Eliminates 500K timer objects at 50K ops/s (massive GC pressure reduction)
- Eliminates `clearTimeout` on every successful response (~50-100ns saved per op)
- `Date.now()` costs ~5ns — negligible
- Net: **~100-200ns per operation** saved + significant GC pause reduction under load

**Risk:** Low. The behavioral change is that timeouts are now checked on a 1-second interval instead of exactly at `timeoutMs`. This means operations may time out up to 1 second late, which is acceptable for a 120-second default timeout. The sweeper pattern is exactly what Hazelcast uses (`InvocationMonitor`).

**Test strategy:**
- Verify timeout tests still pass (search for `OperationTimeoutError` in test files)
- Verify that responses received after timeout are handled gracefully (entry already deleted)
- Full test suite: `bun test`
- Memory profiling: verify heap size is stable at 50k ops/s (no 500K timer objects)

**Rollback:** Revert to per-operation `setTimeout`. The `_pendingResponses` map interface is unchanged.

---

### 1.4 Cache `Address -> MemberId` Mapping

**File:** `src/instance/impl/HeliosInstanceImpl.ts`
**Lines:** ~900-909 (`_findMemberIdByAddress()`)

**Current code pattern:**
```typescript
_findMemberIdByAddress(address: Address): string | undefined {
    for (const [memberId, member] of this._members) {
        if (member.address.equals(address)) {
            return memberId;
        }
    }
    return undefined;
}
```

**Problem:** O(members) linear scan on every operation that routes to a specific member. With 3-10 members, this is 3-10 `Address.equals()` calls per operation. Not catastrophic, but needless.

**New code pattern:**
```typescript
// Instance-level cache:
private _addressToMemberId: Map<string, string> = new Map();

// Build cache key from address:
private _addressKey(address: Address): string {
    return `${address.host}:${address.port}`;
}

// Update cache when members change:
_onMembershipChange() {
    this._addressToMemberId.clear();
    for (const [memberId, member] of this._members) {
        this._addressToMemberId.set(this._addressKey(member.address), memberId);
    }
}

// O(1) lookup:
_findMemberIdByAddress(address: Address): string | undefined {
    return this._addressToMemberId.get(this._addressKey(address));
}
```

**Expected improvement:** ~20-50ns per operation (small but free). The cache is rebuilt only on membership changes, which are rare (seconds to minutes between changes).

**Risk:** Low. The cache is invalidated on every membership change. The only risk is forgetting to call `_onMembershipChange()` — but this should already be centralized.

**Test strategy:**
- Full test suite: `bun test`
- Verify member join/leave tests still pass
- Verify that `_findMemberIdByAddress` returns correct results after cluster topology changes

**Rollback:** Remove the cache map and revert to linear scan.

---

### 1.5 Reuse Serialized Key + Partition Lookup in `MapProxy` Update Paths

**File:** `src/map/impl/MapProxy.ts`
**Lines:** ~204-206

**Current hot path:**
```typescript
async set(key: K, value: V, ttl?: number): Promise<void> {
    const keyData = this._toData(key);
    const valueData = this._toData(value);
    const oldValue = this.containsKey(key) ? await this._readCurrentValue(key) : null;
    await this._invokeOnKeyPartition(new SetOperation(this._name, keyData, valueData, ttl), keyData);
}
```

**Problem:** The duplicate work is not in the transport codec. It is in `MapProxy`'s local pre-read path: `set()`/`delete()` serialize the key, then call helper methods that serialize the same key again and recompute the partition again before the routed operation is invoked.

**Expected code pattern:**
```typescript
async set(key: K, value: V, ttl?: number): Promise<void> {
    const keyData = this._toData(key);
    const valueData = this._toData(value);
    const partitionId = this._partitionIdForKeyData(keyData);
    const oldValue = await this._readCurrentValueByData(keyData, partitionId);
    await this._invokeOnPartition(new SetOperation(this._name, keyData, valueData, ttl), partitionId);
}
```

Apply the same serialized-key reuse to `delete()`.

**Expected improvement:** Saves redundant `toData()` calls and partition lookups on `set()`/`delete()` = **100-500ns** depending on key size and serializer.

**Risk:** Low. Pure logic fix — reuse the already-serialized `Data` and already-computed partition ID for the local pre-read and the routed invoke.

**Test strategy:**
- Full test suite: `bun test`
- Verify map operations still work correctly with all key types
- Microbenchmark: time `MapProxy.set()` before/after

**Rollback:** Revert the single change.

---

### 1.6 Clear Timer References on Successful Response

**File:** `src/instance/impl/HeliosInstanceImpl.ts`
**Lines:** Response handling path (~where `_pendingResponses.get(callId)` is called)

**Note:** This is superseded by 1.3 (sweeper timer). If 1.3 is implemented first, this change is unnecessary. If 1.3 is deferred, implement this as a standalone fix.

**Current code pattern:**
```typescript
_handleResponse(callId, result) {
    const entry = this._pendingResponses.get(callId);
    if (entry) {
        this._pendingResponses.delete(callId);
        entry.resolve(result);
        // timer is NEVER cleared — runs to completion even though response arrived
    }
}
```

**New code pattern:**
```typescript
_handleResponse(callId, result) {
    const entry = this._pendingResponses.get(callId);
    if (entry) {
        clearTimeout(entry.timer); // clear the timer!
        this._pendingResponses.delete(callId);
        entry.resolve(result);
    }
}
```

**Expected improvement:** At 50k ops/s, prevents 50K timers/second from firing their no-op callbacks. Saves GC pressure and event loop scanning. ~50ns per `clearTimeout` call, but the real win is reducing the timer queue from 500K to ~0 under normal operation.

**Risk:** Low. `clearTimeout(undefined)` is safe (no-op). Just ensure the timer handle is stored in the pending entry.

**Test strategy:** Same as 1.3.

**Rollback:** Remove the `clearTimeout` call.

---

### Phase 1 Summary

| Change | ns/op Saved | Cumulative | Risk |
|--------|----------:|------------|------|
| 1.1 TextEncoder | 108 ns | 675 ns | Low |
| 1.2 Stateful frame decoder | 200-400 ns | 375-475 ns | Low-Med |
| 1.3 Sweeper timer | 100-200 ns | 275-375 ns | Low |
| 1.4 Address cache | 20-50 ns | 255-325 ns | Low |
| 1.5 Key serialization fix | 100-500 ns | 155-325 ns | Low |
| 1.6 Clear timers (if not 1.3) | 50 ns | — | Low |
| **Total Phase 1 savings** | **~530-1260 ns** | **~530-1260 ns** | |

**Expected throughput after Phase 1:** Baseline 783ns -> ~520-250ns sync path overhead, yielding **50-65k ops/s** (20-55% improvement from current 41.7k).

---

## Phase 2: Binary Wire Protocol (6-10 hours)

### Objective

Replace the JSON+base64 wire protocol with a binary packet format. This is the **single largest performance win** — it eliminates `JSON.stringify`/`JSON.parse` (591ns combined), base64 encode/decode (+33% wire bloat + 345ns), and reduces wire overhead from 4.8x to ~1.5x. This change alone should more than double throughput.

### Dependencies

- Phase 1.2 (stateful frame decoder) must be completed first, as the binary decoder builds on the same pattern
- The rest of Phase 1 is not required for correctness, but remains the intended execution order

### Risk Level: Medium-High

This is a protocol-level change. It requires:
- All operation types to implement binary serialization
- Backward compatibility strategy (version negotiation or flag day)
- Thorough testing of every operation type

---

### 2.1 Design: Helios Binary Packet Header

Adapting Hazelcast's 11-byte header for Helios:

```
Helios Packet Header (11 bytes):
+---+---+---+---+---+---+---+---+---+---+---+
| V | FLAGS   | PARTITION | PAYLOAD_SIZE      |
+---+---+---+---+---+---+---+---+---+---+---+
  1B    2B        4B           4B

V = Protocol version (0x01 initially)

FLAGS (2 bytes, bit field):
  Bit 0: IS_RESPONSE (0 = request, 1 = response)
  Bit 1: IS_URGENT (priority processing)
  Bit 2: IS_BACKUP (backup replica write)
  Bit 3: IS_EVENT (event notification, not request/response)
  Bit 4: IS_ERROR (response contains error, not result)
  Bit 5: HAS_CALLER_UUID
  Bit 6: HAS_CALL_TIMEOUT
  Bit 7-15: Reserved

PARTITION_ID (4 bytes, signed int32, big-endian):
  -1 = not partition-specific

PAYLOAD_SIZE (4 bytes, uint32, big-endian):
  Size of payload following the header
```

**Differences from Hazelcast:**
- Same header size (11 bytes) for compatibility
- Flags are simplified for Helios's operation types
- Partition ID encoding matches Hazelcast exactly

---

### 2.2 Design: Helios Binary Operation Encoding

Operations are encoded inside the packet payload using Helios's existing `ByteArrayObjectDataOutput`/`ByteArrayObjectDataInput` infrastructure.

**Operation Frame Layout (inside payload):**

```
REQUEST operation encoding:
+----------+------------+----------+---------+-------+-----------+
| IDS_FLAG | FACTORY_ID | CLASS_ID | CALL_ID | FLAGS | PART_ID   |
| 1 byte   | 4 bytes    | 4 bytes  | 8 bytes | 2 B   | 4 bytes   |
+----------+------------+----------+---------+-------+-----------+
| INVOCATION_TIME | CALL_TIMEOUT  | CALLER_UUID   | OP_DATA...  |
| 8 bytes         | 8B (if flag)  | 16B (if flag) | variable    |
+----------+------+---------------+---------------+-------------+

IDS_FLAG:
  Bit 0: HAS_FACTORY_AND_CLASS (always 1 for IdentifiedDataSerializable)
  Bit 1-7: Reserved

CALL_ID: int64 big-endian, monotonically increasing per member
FLAGS:   operation-level flags (internal use)
PART_ID: partition this operation targets (-1 if none)
INVOCATION_TIME: Unix timestamp ms, int64 big-endian
CALL_TIMEOUT: Duration ms, int64 (present only if HAS_CALL_TIMEOUT flag)
CALLER_UUID: 16 bytes raw UUID (present only if HAS_CALLER_UUID flag)
OP_DATA: operation-specific fields written by writeData()
```

**RESPONSE encoding:**

```
+----------+---------+------------------+
| IDS_FLAG | CALL_ID | RESPONSE_DATA... |
| 1 byte   | 8 bytes | variable         |
+----------+---------+------------------+

IDS_FLAG bit 0 = 0: RESPONSE_DATA is raw HeapData bytes (toData() result)
IDS_FLAG bit 0 = 1: RESPONSE_DATA is null (void response)
IDS_FLAG bit 1 = 1: RESPONSE_DATA is error (factoryId + classId + error fields)
```

**HeapData binary encoding (for key/value Data fields within operations):**

```
+--------+----------+-------------------+
| LENGTH | TYPE_ID  | SERIALIZED_BYTES  |
| 4 bytes| 4 bytes  | N bytes           |
+--------+----------+-------------------+

LENGTH = total bytes of TYPE_ID + SERIALIZED_BYTES (i.e., N + 4)
Special case: LENGTH = -1 means null Data
```

This eliminates base64 entirely. Data bytes are written directly into the binary stream.

---

### 2.3 Implement: IdentifiedDataSerializable Registry

**New file:** `src/internal/serialization/IdentifiedDataSerializableRegistry.ts`

```typescript
interface IdentifiedDataSerializable {
    getFactoryId(): number;
    getClassId(): number;
    writeData(out: ObjectDataOutput): void;
}

type OperationDecoder = (inp: ObjectDataInput) => IdentifiedDataSerializable;
type Factory = (classId: number) => OperationDecoder;

class DataSerializableRegistry {
    private _factories: Map<number, Map<number, OperationDecoder>> = new Map();

    register(factoryId: number, classId: number, decoder: OperationDecoder): void;
    decode(factoryId: number, classId: number, inp: ObjectDataInput): IdentifiedDataSerializable;
}
```

**Decode-to-constructor factory pattern**

Helios should decode wire fields directly into the operation constructor instead of mutating partially-built instances later. This preserves the existing operation shape, keeps constructor-required fields immutable, and avoids an extra hydration step on the hot path.

```typescript
registry.register(MAP_FACTORY_ID, SET_CLASS_ID, (inp) => {
    const mapName = inp.readString()!;
    const key = inp.readData()!;
    const value = inp.readData()!;
    const ttl = Number(inp.readLong());
    const maxIdle = Number(inp.readLong());

    return new SetOperation(mapName, key, value, ttl, maxIdle);
});
```

**Why this fits Helios well:**
- Keeps wire-owned fields (`mapName`, `key`, `value`, `ttl`, `maxIdle`) initialized exactly once
- Preserves `readonly`/constructor-required operation fields and avoids broad class churn
- Matches Helios's current JSON wire pattern, where the codec already decodes payloads straight into constructors
- Keeps runtime-owned fields (`partitionId`, `nodeEngine`, `responseHandler`, etc.) as separate post-decode injection, which is already how operation execution works
- Avoids any meaningful performance penalty: constructor creation is already required, and skipping a second mutation/hydration pass is at least neutral and typically slightly better for JIT stability

**Phase 2 scope (must match the current wire surface):**

- Connection/control messages: `HELLO`, `JOIN_REQUEST`, `FINALIZE_JOIN`, `MEMBERS_UPDATE`, `PARTITION_STATE`, `HEARTBEAT`, `FETCH_MEMBERS_VIEW`, `MEMBERS_VIEW_RESPONSE`
- Operation transport messages: `OPERATION`, `OPERATION_RESPONSE`, `BACKUP`, `BACKUP_ACK`
- Recovery messages: `RECOVERY_ANTI_ENTROPY`, `RECOVERY_SYNC_REQUEST`, `RECOVERY_SYNC_RESPONSE`
- Queue messages: `QUEUE_REQUEST`, `QUEUE_RESPONSE`, `QUEUE_STATE_SYNC`, `QUEUE_STATE_ACK`, `QUEUE_EVENT`
- Topic messages: `TOPIC_MESSAGE`, `TOPIC_PUBLISH_REQUEST`, `TOPIC_ACK`, `RELIABLE_TOPIC_PUBLISH_REQUEST`, `RELIABLE_TOPIC_PUBLISH_ACK`, `RELIABLE_TOPIC_MESSAGE`, `RELIABLE_TOPIC_BACKUP`, `RELIABLE_TOPIC_BACKUP_ACK`, `RELIABLE_TOPIC_DESTROY`
- Blitz messages: `BLITZ_NODE_REGISTER`, `BLITZ_NODE_REMOVE`, `BLITZ_TOPOLOGY_REQUEST`, `BLITZ_TOPOLOGY_RESPONSE`, `BLITZ_TOPOLOGY_ANNOUNCE`
- Legacy compatibility messages still present on the transport surface: `MAP_PUT`, `MAP_REMOVE`, `MAP_CLEAR`, `INVALIDATE`

**Factory/Class ID assignments for operation payloads (current minimum set):**

| Factory ID | Factory | Class IDs |
|-----------|---------|-----------|
| 1 | MapOperationFactory | 1=PutOperation, 2=GetOperation, 3=RemoveOperation, 4=DeleteOperation, 5=SetOperation, 6=PutIfAbsentOperation, 7=ClearOperation, 8=ExternalStoreClearOperation, 9=PutBackupOperation, 10=RemoveBackupOperation |
| 2 | ExecutorOperationFactory | 1=ExecuteCallableOperation, 2=MemberCallableOperation, 3=CancellationOperation, 4=ShutdownOperation |

Message-level packet codecs cover the rest of `ClusterMessage` directly; they do not need to be modeled as operation factories unless a later refactor deliberately moves them into the operation registry.

**Files modified:**
- All wire-serialized Operation subclasses (add `getFactoryId()`, `getClassId()`, `writeData()`)
- Factory/registry modules for constructor-based decoders
- `src/spi/impl/operationservice/OperationWireCodec.ts` (rewrite to use binary)
- `src/cluster/tcp/SerializationStrategy.ts` (new `BinarySerializationStrategy`)
- Message codec implementations for every current `ClusterMessage` variant carried by `TcpClusterTransport`

**Risk:** Medium. Every operation type must be updated. Missing or incorrect `writeData()` or decoder logic will cause data corruption.

**Mitigation:** Add round-trip unit test for every operation: `op -> writeData -> decoder(inp) -> verify fields match`.

---

### 2.4 Implement: BinarySerializationStrategy

**File:** `src/cluster/tcp/BinarySerializationStrategy.ts` (new)
**Also modify:** `src/cluster/tcp/SerializationStrategy.ts` (add strategy selection)

```typescript
class BinarySerializationStrategy implements SerializationStrategy {
    private _registry: DataSerializableRegistry;

    serialize(message: ClusterMessage): Uint8Array {
        const out = new ByteArrayObjectDataOutput(256); // pooled in Phase 3

        // Write packet header (11 bytes)
        out.writeByte(PROTOCOL_VERSION);          // 1B
        out.writeShort(this._buildFlags(message)); // 2B
        out.writeInt(this._extractPartitionId(message)); // 4B
        // Placeholder for payload size — fill after encoding
        const sizeOffset = out.position();
        out.writeInt(0);                           // 4B placeholder

        const payloadStart = out.position();

        out.writeShort(MESSAGE_TYPE_IDS[message.type]);
        this._writeMessageBody(out, message);

        // Fill in payload size
        const payloadSize = out.position() - payloadStart;
        out.writeIntAt(sizeOffset, payloadSize);

        return out.toByteArray();
    }

    deserialize(data: Uint8Array): ClusterMessage {
        const inp = new ByteArrayObjectDataInput(data);

        // Read packet header
        const version = inp.readByte();
        const flags = inp.readUnsignedShort();
        const partitionId = inp.readInt();
        const payloadSize = inp.readInt();

        const messageTypeId = inp.readUnsignedShort();
        return this._readMessageBody(inp, messageTypeId, flags, partitionId);
    }

    private _writeMessageBody(out: ObjectDataOutput, msg: ClusterMessage): void {
        switch (msg.type) {
            case 'OPERATION':
                out.writeLong(BigInt(msg.callId));
                out.writeInt(msg.partitionId);
                out.writeString(msg.senderId);
                out.writeShort(operationFactoryId(msg.operationType));
                out.writeShort(operationClassId(msg.operationType));
                writeOperationPayload(out, msg.payload);
                return;
            case 'OPERATION_RESPONSE':
                out.writeLong(BigInt(msg.callId));
                writeOperationResponsePayload(out, msg.payload, msg.error);
                return;
            default:
                writeDirectClusterMessage(out, msg);
                return;
        }
    }

    private _readMessageBody(inp: ObjectDataInput, messageTypeId: number, flags: number, partitionId: number): ClusterMessage {
        switch (messageTypeId) {
            case MESSAGE_TYPE_ID.OPERATION: {
                const callId = Number(inp.readLong());
                const opPartitionId = inp.readInt();
                const senderId = inp.readString()!;
                const factoryId = inp.readUnsignedShort();
                const classId = inp.readUnsignedShort();
                const op = this._registry.decode(factoryId, classId, inp);
                return buildOperationMessage(callId, opPartitionId, senderId, op);
            }
            case MESSAGE_TYPE_ID.OPERATION_RESPONSE:
                return readOperationResponsePayload(inp);
            default:
                return readDirectClusterMessage(inp, messageTypeId);
        }
    }
}
```

The real implementation is message-dispatch based, not a generic `request/response` abstraction. `OPERATION`, `OPERATION_RESPONSE`, and `BACKUP` use the operation registry; all other `ClusterMessage` variants use the exact layouts from `2.5B`.

---

### 2.5 Implement: Binary `writeData()` on Each Operation + Registry Decoders

Note: Helios keeps encoding logic on the operation class and decoding logic in the registry. Each wire-serialized operation implements binary `writeData()`, and each registry entry reads fields from `ObjectDataInput` and returns a fully-constructed operation.

**Example: SetOperation**

**File:** `src/map/impl/operation/SetOperation.ts`

```typescript
class SetOperation extends AbstractMapOperation implements IdentifiedDataSerializable {
    private _name: string;
    private _key: Data;
    private _value: Data;
    private _ttl: number;
    private _maxIdle: number;

    getFactoryId(): number { return 1; } // MapOperationFactory
    getClassId(): number { return 1; }   // SetOperation

    writeData(out: ObjectDataOutput): void {
        out.writeString(this._name);          // map name
        out.writeData(this._key);             // key as HeapData bytes (no base64!)
        out.writeData(this._value);           // value as HeapData bytes
        out.writeLong(this._ttl ?? -1);       // TTL in ms, -1 = infinite
        out.writeLong(this._maxIdle ?? -1);   // Max idle in ms, -1 = infinite
    }
}

registry.register(1, 1, (inp) => {
    const name = inp.readString()!;
    const key = inp.readData()!;
    const value = inp.readData()!;
    const ttl = Number(inp.readLong());
    const maxIdle = Number(inp.readLong());

    return new SetOperation(name, key, value, ttl, maxIdle);
});
```

**Binary helpers for Data fields (in `ObjectDataOutput`/`ObjectDataInput`):**

```typescript
// ObjectDataOutput
writeData(data: Data | null): void {
    if (data === null) {
        this.writeInt(-1); // null marker
        return;
    }
    const bytes = data.toBuffer();
    this.writeInt(bytes.length);
    this.writeBytes(bytes); // raw bytes, NO base64
}

// ObjectDataInput
readData(): Data | null {
    const len = this.readInt();
    if (len === -1) return null;
    const bytes = this.readBytes(len);
    return new HeapData(Buffer.from(bytes));
}
```

**Operations requiring `writeData()` plus registry decoder coverage (current wire surface):**

| Operation | Factory ID | Class ID | Fields |
|-----------|-----------|---------|--------|
| PutOperation | 1 | 1 | mapName, key, value, ttl, maxIdle |
| GetOperation | 1 | 2 | mapName, key |
| RemoveOperation | 1 | 3 | mapName, key |
| DeleteOperation | 1 | 4 | mapName, key |
| SetOperation | 1 | 5 | mapName, key, value, ttl, maxIdle |
| PutIfAbsentOperation | 1 | 6 | mapName, key, value, ttl, maxIdle |
| ClearOperation | 1 | 7 | mapName |
| ExternalStoreClearOperation | 1 | 8 | mapName |
| PutBackupOperation | 1 | 9 | mapName, key, value, ttl, maxIdle |
| RemoveBackupOperation | 1 | 10 | mapName, key |
| ExecuteCallableOperation | 2 | 1 | taskUuid, executorName, taskType, registrationFingerprint, inputData, submitterMemberUuid, timeoutMillis |
| MemberCallableOperation | 2 | 2 | descriptor fields + targetMemberUuid |
| CancellationOperation | 2 | 3 | executorName, taskUuid |
| ShutdownOperation | 2 | 4 | executorName |

**ClusterMessage variants requiring direct binary message codecs (non-operation payloads):**

| Message type | Fields |
|-------------|--------|
| `HELLO` | nodeId |
| `JOIN_REQUEST` | joinerAddress, joinerUuid, clusterName, partitionCount, joinerVersion |
| `FINALIZE_JOIN` | memberListVersion, members, masterAddress, clusterId |
| `MEMBERS_UPDATE` | memberListVersion, members, masterAddress, clusterId |
| `PARTITION_STATE` | versions, partitions |
| `HEARTBEAT` | senderUuid, timestamp |
| `FETCH_MEMBERS_VIEW` | requesterId, requestTimestamp |
| `MEMBERS_VIEW_RESPONSE` | memberListVersion, members |
| `OPERATION` | callId, partitionId, senderId, encoded operation payload |
| `OPERATION_RESPONSE` | callId, payload, error |
| `BACKUP` | callId, partitionId, replicaIndex, encoded operation payload |
| `BACKUP_ACK` | callId |
| `RECOVERY_ANTI_ENTROPY` | senderId, partitionId, replicaIndex, primaryVersions, namespaceVersions |
| `RECOVERY_SYNC_REQUEST` | requesterId, partitionId, replicaIndex, dirtyNamespaces |
| `RECOVERY_SYNC_RESPONSE` | partitionId, replicaIndex, versions, namespaceVersions, namespaceStates |
| `QUEUE_REQUEST` / `QUEUE_RESPONSE` / `QUEUE_STATE_SYNC` / `QUEUE_STATE_ACK` / `QUEUE_EVENT` | exact field order defined in 2.5B |
| `TOPIC_MESSAGE` / `TOPIC_PUBLISH_REQUEST` / `TOPIC_ACK` | exact field order defined in 2.5B |
| `RELIABLE_TOPIC_PUBLISH_REQUEST` / `RELIABLE_TOPIC_PUBLISH_ACK` / `RELIABLE_TOPIC_MESSAGE` / `RELIABLE_TOPIC_BACKUP` / `RELIABLE_TOPIC_BACKUP_ACK` / `RELIABLE_TOPIC_DESTROY` | exact field order defined in 2.5B |
| `BLITZ_NODE_REGISTER` / `BLITZ_NODE_REMOVE` / `BLITZ_TOPOLOGY_REQUEST` / `BLITZ_TOPOLOGY_RESPONSE` / `BLITZ_TOPOLOGY_ANNOUNCE` | exact field order defined in 2.5B |
| `MAP_PUT` / `MAP_REMOVE` / `MAP_CLEAR` / `INVALIDATE` | exact field order defined in 2.5B |

### 2.5A Common Binary Codec Rules (authoritative)

Every binary codec in Phase 2 uses the same field primitives. This removes ambiguity for queue/topic/blitz/control messages and makes all message codecs table-driven.

**Primitive encodings:**

```typescript
int8 / uint8   = 1 byte
int16 / uint16 = 2 bytes, big-endian
int32 / uint32 = 4 bytes, big-endian
int64          = 8 bytes, big-endian
boolean        = uint8 (0 = false, 1 = true)
```

**Variable encodings:**

```typescript
string         = int32 byteLength, then UTF-8 bytes; -1 means null
byte[]         = int32 length, then raw bytes; -1 means null
string[]       = int32 count, then `string` repeated; -1 means null
int64[]        = int32 count, then int64 repeated; -1 means null
uuid-string    = string (do not assume 16-byte binary UUID for all current ids)
```

**Structured helper encodings:**

```typescript
Address        = string host + int32 port
MemberVersion  = int32 major + int32 minor + int32 patch
WireMemberInfo = Address + uuid-string + StringMap(attributes) + boolean liteMember
                 + MemberVersion + int32 memberListJoinVersion
EncodedData    = byte[] raw HeapData bytes
StringMap      = int32 count, then repeated [string key][string value]
StringArrayMap = int32 count, then repeated [string key][string[] values]
```

**Top-level packet payload prefix:**

Every packet payload starts with a `messageTypeId` so `BinarySerializationStrategy.deserialize()` can dispatch without relying on JSON discriminants.

```typescript
Packet payload = uint16 messageTypeId + message-specific fields
```

**Message type IDs:**

| ID | Message |
|---:|---------|
| 1 | `HELLO` |
| 2 | `MAP_PUT` |
| 3 | `MAP_REMOVE` |
| 4 | `MAP_CLEAR` |
| 5 | `INVALIDATE` |
| 6 | `JOIN_REQUEST` |
| 7 | `FINALIZE_JOIN` |
| 8 | `MEMBERS_UPDATE` |
| 9 | `PARTITION_STATE` |
| 10 | `HEARTBEAT` |
| 11 | `FETCH_MEMBERS_VIEW` |
| 12 | `MEMBERS_VIEW_RESPONSE` |
| 13 | `OPERATION` |
| 14 | `OPERATION_RESPONSE` |
| 15 | `BACKUP` |
| 16 | `BACKUP_ACK` |
| 17 | `RECOVERY_ANTI_ENTROPY` |
| 18 | `RECOVERY_SYNC_REQUEST` |
| 19 | `RECOVERY_SYNC_RESPONSE` |
| 20 | `QUEUE_REQUEST` |
| 21 | `QUEUE_RESPONSE` |
| 22 | `QUEUE_STATE_SYNC` |
| 23 | `QUEUE_STATE_ACK` |
| 24 | `QUEUE_EVENT` |
| 25 | `TOPIC_MESSAGE` |
| 26 | `TOPIC_PUBLISH_REQUEST` |
| 27 | `TOPIC_ACK` |
| 28 | `RELIABLE_TOPIC_PUBLISH_REQUEST` |
| 29 | `RELIABLE_TOPIC_PUBLISH_ACK` |
| 30 | `RELIABLE_TOPIC_MESSAGE` |
| 31 | `RELIABLE_TOPIC_BACKUP` |
| 32 | `RELIABLE_TOPIC_BACKUP_ACK` |
| 33 | `RELIABLE_TOPIC_DESTROY` |
| 34 | `BLITZ_NODE_REGISTER` |
| 35 | `BLITZ_NODE_REMOVE` |
| 36 | `BLITZ_TOPOLOGY_REQUEST` |
| 37 | `BLITZ_TOPOLOGY_RESPONSE` |
| 38 | `BLITZ_TOPOLOGY_ANNOUNCE` |

### 2.5B Exact Binary Message Layouts

The following field order is authoritative for all non-operation message codecs.

**Connection and cluster-control messages**

```typescript
HELLO                   = messageTypeId + string nodeId
JOIN_REQUEST            = messageTypeId + Address joinerAddress + string joinerUuid
                           + string clusterName + int32 partitionCount + MemberVersion joinerVersion
FINALIZE_JOIN           = messageTypeId + int32 memberListVersion + WireMemberInfo[] members
                           + Address masterAddress + string clusterId
MEMBERS_UPDATE          = messageTypeId + int32 memberListVersion + WireMemberInfo[] members
                           + Address masterAddress + string clusterId
PARTITION_STATE         = messageTypeId + int32[] versions + PartitionReplicaMatrix partitions
HEARTBEAT               = messageTypeId + string senderUuid + int64 timestamp
FETCH_MEMBERS_VIEW      = messageTypeId + string requesterId + int64 requestTimestamp
MEMBERS_VIEW_RESPONSE   = messageTypeId + int32 memberListVersion + WireMemberInfo[] members
```

**Operation transport messages**

```typescript
OPERATION               = messageTypeId + int64 callId + int32 partitionId + string senderId
                           + uint16 factoryId + uint16 classId + OperationPayload
BACKUP                  = messageTypeId + int64 callId + int32 partitionId + int32 replicaIndex
                           + uint16 factoryId + uint16 classId + OperationPayload
BACKUP_ACK              = messageTypeId + int64 callId
OPERATION_RESPONSE      = messageTypeId + int64 callId + uint8 responseKind + ResponsePayload

responseKind:
  0 = void
  1 = data            -> EncodedData
  2 = boolean         -> boolean
  3 = number          -> int64
  4 = string          -> string
  5 = data-array      -> EncodedData[]
  6 = executor-result -> ExecutorResult struct
  7 = error           -> ErrorEnvelope struct
```

**Recovery messages**

```typescript
RECOVERY_ANTI_ENTROPY   = messageTypeId + string senderId + int32 partitionId + int32 replicaIndex
                            + int64[] primaryVersions + StringArrayMap namespaceVersions
RECOVERY_SYNC_REQUEST   = messageTypeId + string requesterId + int32 partitionId + int32 replicaIndex
                            + string[] dirtyNamespaces
RECOVERY_SYNC_RESPONSE  = messageTypeId + int32 partitionId + int32 replicaIndex + int64[] versions
                            + StringArrayMap namespaceVersions + NamespaceState[] namespaceStates
```

**Queue messages**

```typescript
QUEUE_REQUEST           = messageTypeId + string requestId + string sourceNodeId + string queueName
                           + string operation + int64 timeoutMsOrMinus1 + uint8 hasData + EncodedData? data
                           + EncodedData[] dataList + int32 maxElementsOrMinus1
QUEUE_RESPONSE          = messageTypeId + string requestId + boolean success + uint8 resultType
                           + boolean booleanResult + int64 numberResult + uint8 hasData + EncodedData? data
                           + EncodedData[] dataList + string errorOrNull
QUEUE_STATE_SYNC        = messageTypeId + string requestIdOrNull + string sourceNodeId + string queueName
                           + int64 version + int64 nextItemId + QueueStateItem[] items + string ownerNodeId
                           + QueueCounters counters
QUEUE_STATE_ACK         = messageTypeId + string requestId + string queueName + int64 version
QUEUE_EVENT             = messageTypeId + string queueName + uint8 eventType + string sourceNodeId
                           + uint8 hasData + EncodedData? data
```

**Topic messages**

```typescript
TOPIC_MESSAGE                 = messageTypeId + string topicName + EncodedData data + int64 publishTime
                                 + string sourceNodeId + int64 sequenceOrMinus1
TOPIC_PUBLISH_REQUEST         = messageTypeId + string requestId + string topicName + EncodedData data
                                 + int64 publishTime + string sourceNodeId
TOPIC_ACK                     = messageTypeId + string requestId + string errorOrNull
RELIABLE_TOPIC_PUBLISH_REQUEST= messageTypeId + string requestId + string topicName + EncodedData data
                                 + string sourceNodeId
RELIABLE_TOPIC_PUBLISH_ACK    = messageTypeId + string requestId + string errorOrNull
RELIABLE_TOPIC_MESSAGE        = messageTypeId + string topicName + int64 sequence + int64 publishTime
                                 + string publisherAddressOrNull + EncodedData data
RELIABLE_TOPIC_BACKUP         = messageTypeId + string requestIdOrNull + string topicName + int64 sequence
                                 + int64 publishTime + string publisherAddressOrNull + EncodedData data
                                 + string sourceNodeId
RELIABLE_TOPIC_BACKUP_ACK     = messageTypeId + string requestId
RELIABLE_TOPIC_DESTROY        = messageTypeId + string topicName
```

**Blitz messages**

```typescript
BLITZ_NODE_REGISTER      = messageTypeId + BlitzNodeRegistration
BLITZ_NODE_REMOVE        = messageTypeId + string memberId
BLITZ_TOPOLOGY_REQUEST   = messageTypeId + string requestId
BLITZ_TOPOLOGY_RESPONSE  = messageTypeId + string requestId + string[] routes + string masterMemberId
                           + int32 memberListVersion + string fenceToken + boolean registrationsComplete
                           + int64 retryAfterMsOrMinus1 + string clientConnectUrl
BLITZ_TOPOLOGY_ANNOUNCE  = messageTypeId + int32 memberListVersion + string[] routes
                           + string masterMemberId + string fenceToken
```

**Legacy compatibility messages**

```typescript
MAP_PUT                  = messageTypeId + string mapName + EncodedData key + EncodedData value
MAP_REMOVE               = messageTypeId + string mapName + EncodedData key
MAP_CLEAR                = messageTypeId + string mapName
INVALIDATE               = messageTypeId + string mapName + EncodedData key
```

**Additional helper structs:**

```typescript
PartitionReplica         = uint8 isNull + (if 0 then Address + string uuid)
PartitionReplicaRow      = int32 replicaCount + PartitionReplica repeated
PartitionReplicaMatrix   = int32 partitionCount + PartitionReplicaRow repeated
WireMemberInfo[]         = int32 count + WireMemberInfo repeated
EncodedData[]            = int32 count + EncodedData repeated; -1 means null
QueueStateItem           = int64 itemId + int64 enqueuedAt + EncodedData data
QueueCounters            = int64 offerOperationCount + int64 rejectedOfferOperationCount
                           + int64 pollOperationCount + int64 emptyPollOperationCount
                           + int64 otherOperationCount + int64 eventOperationCount
NamespaceState           = string namespace + int64 estimatedSizeBytes + EntryState[] entries
EntryState               = EncodedData key + EncodedData value
ExecutorResult           = string taskUuid + string status + string originMemberUuid
                           + uint8 hasResultData + EncodedData? resultData
                           + string errorNameOrNull + string errorMessageOrNull
ErrorEnvelope            = string errorClass + string message + string stackTraceOrNull
BlitzNodeRegistration    = string memberId + int32 memberListVersion + string serverName
                           + int32 clientPort + int32 clusterPort + string advertiseHost
                           + string clusterName + boolean ready + int64 startedAt
```

**File modifications required:**
- Each operation class file listed above
- Factory/registry files that decode binary payloads into constructors
- `src/internal/serialization/impl/ByteArrayObjectDataOutput.ts` — use/add canonical helpers `writeData()`, `writeString()`, `writeStringArray()`, `writeByteArray()`
- `src/internal/serialization/impl/ByteArrayObjectDataInput.ts` — use/add canonical helpers `readData()`, `readString()`, `readStringArray()`, `readByteArray()`
- `src/cluster/tcp/ClusterMessage.ts` message codec layer and binary message dispatch tables for all current message variants

---

### 2.6 Implement: PacketEncoder / PacketDecoder

**New file:** `src/cluster/tcp/PacketEncoder.ts`

```typescript
class PacketEncoder {
    private _strategy: BinarySerializationStrategy;

    /**
     * Encode a ClusterMessage into a length-prefixed binary frame.
     * Frame format: [LENGTH 4B][PACKET_HEADER 11B][PAYLOAD NB]
     * LENGTH = 11 + N (size of header + payload)
     */
    encode(message: ClusterMessage): Uint8Array {
        const packet = this._strategy.serialize(message);
        const frame = new Uint8Array(4 + packet.length);
        const view = new DataView(frame.buffer);
        view.setUint32(0, packet.length); // length prefix
        frame.set(packet, 4);
        return frame;
    }
}
```

**New file:** `src/cluster/tcp/PacketDecoder.ts`

```typescript
class PacketDecoder {
    private _strategy: BinarySerializationStrategy;

    /**
     * Decode a frame payload (after length prefix stripping) into a ClusterMessage.
     * Called by the stateful frame decoder in TcpClusterTransport._onData().
     */
    decode(frame: Uint8Array): ClusterMessage {
        return this._strategy.deserialize(frame);
    }
}
```

**Integration point:** `TcpClusterTransport._onFrame(frame)` calls `PacketDecoder.decode(frame)` instead of `JSON.parse(frame.toString())`.

---

### 2.7 Backward Compatibility Strategy

Phase 2 uses a single explicit rollout mode so implementation and testing stay deterministic.

1. Add `helios.network.protocol: 'binary' | 'json'` config option
2. All members in a cluster must use the same protocol setting
3. Mixed clusters are rejected during the `HELLO` handshake
4. If a peer advertises a different protocol, close the connection and log a clear incompatibility error
5. Rolling upgrade support is out of scope for this plan and is not required to hit the throughput goal

**Implementation:**
- `SerializationStrategy` interface already exists — add `BinarySerializationStrategy` alongside `JsonSerializationStrategy`
- `TcpClusterTransport` constructor selects strategy based on config
- Both strategies produce/consume length-prefixed frames, so the framing layer is unchanged
- Extend `HELLO` to carry `protocol: 'json' | 'binary'` and `protocolVersion: number`
- Connection acceptance rule: only admit peers whose `protocol` and `protocolVersion` exactly match the local node

---

### 2.8 Wire Format Comparison

**Before (JSON+base64, SetOperation with 50B key + 120B value):**

```
Frame: [LENGTH 4B][JSON ~260B]

JSON payload (~260 bytes):
{"type":"request","callId":12345,"partitionId":42,
 "operation":{"factoryId":1,"classId":1,
   "name":"myMap",
   "key":"base64encodedkeydatahere==",         <- +33% bloat
   "value":"base64encodedvaluedatahere=="       <- +33% bloat
 }}
```

Total: 264 bytes. Actual data: 54 bytes. **Overhead: 4.9x**

**After (binary, same operation):**

```
Frame: [LENGTH 4B][HEADER 11B][PAYLOAD ~80B]

Header (11 bytes):
  01 00 00 00 00 00 2A 00 00 00 50

Payload (~80 bytes):
  01                              IDS_FLAG (1B)
  00 00 00 01                     factoryId=1 (4B)
  00 00 00 01                     classId=1 (4B)
  00 00 00 00 00 00 30 39         callId=12345 (8B)
  00 00                           flags (2B)
  00 00 00 2A                     partitionId=42 (4B)
  00 00 01 8E 2B 3C 4D 50         invocationTime (8B)
  00 05 6D 79 4D 61 70            name="myMap" (2+5B)
  00 00 00 36 [50 bytes]          key Data (4+50B)
  00 00 00 78 [120 bytes]         value Data (4+120B)
```

Total: 95 bytes. Actual data: 54 bytes. **Overhead: 1.76x**

**Wire savings: 64% reduction in bytes per operation.**

---

### Phase 2 Performance Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| `JSON.stringify` cost | 236 ns | 0 ns | -236 ns |
| `JSON.parse` cost | 355 ns | 0 ns | -355 ns |
| Base64 encode (key+value) | 99 ns | 0 ns | -99 ns |
| Base64 decode (key+value) | 246 ns | 0 ns | -246 ns |
| `Buffer.from(str, 'utf8')` | 187 ns | 0 ns | -187 ns |
| `buf.toString('utf8')` | ~100 ns | 0 ns | -100 ns |
| Binary encode cost | 0 ns | ~120 ns | +120 ns |
| Binary decode cost | 0 ns | ~100 ns | +100 ns |
| **Net per-op savings** | | | **~1,003 ns** |
| Wire bytes/op | 264 B | 95 B | **64% smaller** |
| Bandwidth at 50k ops/s | 13.2 MB/s | 4.75 MB/s | **64% less I/O** |

**Expected throughput after Phase 2:** Combined with Phase 1, the per-operation processing time drops from ~783ns to ~150-200ns. The reduced wire size also means less I/O pressure and less time in `socket.write()`. Expected: **80-120k ops/s** (2-3x current).

### Test Strategy

1. **Unit tests for each operation:** Round-trip test — create operation with known fields, `writeData()` to buffer, decode via registry, verify all fields match
2. **Unit tests for each direct message codec:** Encode/decode every non-operation `ClusterMessage` variant from `2.5B`, verify exact equality
3. **Unit tests for PacketEncoder/Decoder:** Encode a `ClusterMessage`, decode it, verify equality and correct `messageTypeId` dispatch
4. **Integration test:** Run 4-node cluster with binary protocol, exercise join, membership updates, partition state, map operations, recovery, queue, topic, and blitz flows, verify correctness
5. **Protocol compatibility test:** Run mixed cluster (1 JSON node + 3 binary nodes), verify incompatible peers are rejected during `HELLO` and the error is explicit
6. **Stress test:** 4-node cluster at max throughput, verify 0 errors
7. **Fuzz test:** Feed random bytes to `PacketDecoder`, verify it throws clean errors (no crash, no hang)

### Rollback Plan

- `BinarySerializationStrategy` is a new class alongside `JsonSerializationStrategy`
- Config flag selects which strategy to use
- Rollback = change config to `'json'`
- No existing code is deleted until binary is proven stable

---

## Phase 3: Buffer Pooling & Allocation Reduction (3-5 hours)

### Objective

Reduce per-operation memory allocation and GC pressure by pooling frequently allocated buffers and reducing the number of Promise/closure objects per operation. Target: reduce allocations from ~8-12 per operation to ~2-3.

### Dependencies

- Phase 2 (binary protocol) — pooling is most effective when we control the binary encode/decode buffers
- Phase 1.3 (sweeper timer) — reduces timer allocations

### Risk Level: Medium

Buffer pooling bugs can cause data corruption (returning a buffer to the pool while still in use) or memory leaks (forgetting to return buffers). Careful lifecycle management is required.

---

### 3.1 Implement BufferPool

**New file:** `src/internal/util/BufferPool.ts`

```typescript
/**
 * Module-level buffer pool for ByteArrayObjectDataOutput buffers.
 * Equivalent to Hazelcast's thread-local BufferPool, but since JS is
 * single-threaded, a module-level pool is sufficient (no synchronization needed).
 *
 * Design: max 6 pooled buffers (3 for encode, 3 for decode — matching Hazelcast).
 * Buffers are pre-allocated at 4KB and grow as needed. When returned to pool,
 * they keep their grown capacity (no shrink) for reuse.
 */
class BufferPool {
    private _pool: ByteArrayObjectDataOutput[] = [];
    private _maxSize: number = 6;
    private _initialCapacity: number = 4096;

    take(): ByteArrayObjectDataOutput {
        if (this._pool.length > 0) {
            const buf = this._pool.pop()!;
            buf.reset(); // reset position to 0, keep capacity
            return buf;
        }
        return new ByteArrayObjectDataOutput(this._initialCapacity);
    }

    return(buf: ByteArrayObjectDataOutput): void {
        if (this._pool.length < this._maxSize) {
            this._pool.push(buf);
        }
        // If pool is full, buffer is GC'd — this is fine
    }
}

// Module-level singleton
export const bufferPool = new BufferPool();
```

**Files modified:**
- `src/internal/serialization/impl/ByteArrayObjectDataOutput.ts` — add `reset()` method that sets `_pos = 0` without reallocating
- `src/cluster/tcp/BinarySerializationStrategy.ts` — use `bufferPool.take()` / `bufferPool.return()` in `serialize()`/`deserialize()`
- `src/internal/serialization/impl/SerializationServiceImpl.ts` — use pool in `toData()`

**Expected improvement:**
- Eliminates ~2-4 `Buffer.allocUnsafe()` calls per operation
- Each allocation + GC costs ~50-100ns; saving 2-4 = **100-400ns per operation**
- Reduces GC pressure significantly under sustained load

**Risk:** Medium. Must ensure:
- Buffer is ALWAYS returned to pool (use try/finally)
- Buffer is NEVER used after being returned (reset clears position, but data is still there)
- Pool does not leak (max size cap prevents unbounded growth)

**Test strategy:**
- Unit test: take, write, return, take again — verify buffer is reused (check capacity >= previous write)
- Unit test: take more than `_maxSize` — verify no error, extras are just not pooled
- Full test suite: `bun test`
- Memory profiling: verify heap allocations per operation decrease

**Rollback:** Remove pool usage, revert to `new ByteArrayObjectDataOutput()` everywhere.

---

### 3.2 Reduce Promise Chain Per Operation

**Files:**
- `src/instance/impl/HeliosInstanceImpl.ts` (remoteSend)
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts` (invokeOnPartition)
- `src/spi/impl/operationservice/Invocation.ts`
- `src/spi/impl/operationservice/InvocationFuture.ts`

**Current state:** Each operation creates 4 Promises and ~7 closures:

```
1. new Promise() in remoteSend                    [Promise #1]
2. invocationFuture.promise                       [Promise #2]
3. .then() in invokeOnPartition                   [Promise #3, closure #1-2]
4. .then() or await in MapProxy                   [Promise #4, closure #3-4]
5. setTimeout callback                            [closure #5]
6. response handler closure                       [closure #6]
7. error handler closure                          [closure #7]
```

**New design — Single Promise per operation:**

```typescript
// In HeliosInstanceImpl.remoteSend():
remoteSend(op: Operation, partitionId: number): Promise<Data | null> {
    const callId = this._nextCallId();

    // Single promise — resolve/reject stored directly in pending map
    return new Promise<Data | null>((resolve, reject) => {
        this._pendingResponses.set(callId, {
            resolve,
            reject,
            createdAt: Date.now(),
        });

        // Encode and send — no intermediate promises
        const frame = this._encoder.encode(op, callId, partitionId);
        const sent = this._transport.send(targetAddress, frame);
        if (!sent) {
            this._pendingResponses.delete(callId);
            reject(new HazelcastError('Send failed'));
        }
    });
}

// In MapProxy — direct await, no .then() chain:
async set(key: K, value: V): Promise<void> {
    const keyData = this._toData(key);
    const valueData = this._toData(value);
    const partitionId = this._getPartitionId(keyData);
    const op = new SetOperation(this._name, keyData, valueData);
    await this._invokeOnPartition(op, partitionId); // single await
}
```

**Expected improvement:**
- 4 Promises -> 1 Promise: saves ~3 * 80ns = **240ns per operation** (Promise allocation + microtask scheduling)
- 7 closures -> 2 closures: saves ~5 * 30ns = **150ns per operation** (closure allocation + GC)
- Total: **~390ns per operation**

**Risk:** Medium. Changing the Promise chain requires careful verification that:
- Error propagation still works correctly
- Cancellation/timeout still works
- `InvocationFuture` features (retry, redirect) still work
- All callers handle the simplified return type

**Test strategy:**
- All existing tests must pass (they exercise the full Promise chain)
- Add specific test for: operation succeeds, operation fails, operation times out, operation retried
- Performance: verify allocation count per operation via `--expose-gc` heap snapshot

**Rollback:** Revert to multi-Promise chain.

---

### 3.3 Object Pooling for Invocation Entries

**File:** `src/instance/impl/HeliosInstanceImpl.ts`

Instead of creating a new `{ resolve, reject, createdAt }` object per operation, pool them:

```typescript
interface PendingEntry {
    resolve: ((value: Data | null) => void) | null;
    reject: ((reason: any) => void) | null;
    createdAt: number;
}

class PendingEntryPool {
    private _pool: PendingEntry[] = [];
    private _maxSize = 1024;

    take(resolve: Function, reject: Function): PendingEntry {
        let entry: PendingEntry;
        if (this._pool.length > 0) {
            entry = this._pool.pop()!;
        } else {
            entry = { resolve: null, reject: null, createdAt: 0 };
        }
        entry.resolve = resolve;
        entry.reject = reject;
        entry.createdAt = Date.now();
        return entry;
    }

    return(entry: PendingEntry): void {
        entry.resolve = null; // release closure references for GC
        entry.reject = null;
        if (this._pool.length < this._maxSize) {
            this._pool.push(entry);
        }
    }
}
```

**Expected improvement:** ~30-50ns per operation (avoids object literal allocation + shape transition in V8/JSC). Small but measurable at high throughput.

**Risk:** Low-Medium. Must null out `resolve`/`reject` when returning to pool to avoid leaking closures.

**Test strategy:** Same as 3.2.

**Rollback:** Remove pool, revert to object literal creation.

---

### 3.4 Reuse Outbound Frame Buffers

**File:** `src/cluster/tcp/PacketEncoder.ts`

Currently, every `encode()` call allocates a new `Uint8Array` for the frame. Use a reusable staging buffer, but always return an owned frame buffer to the caller. This keeps the optimization safe and deterministic.

```typescript
class PacketEncoder {
    private _outputBuffer: Uint8Array = new Uint8Array(4096);
    private _outputView: DataView = new DataView(this._outputBuffer.buffer);

    encode(message: ClusterMessage): Uint8Array {
        const out = bufferPool.take();
        try {
            this._strategy.serializeInto(out, message);
            const packetSize = out.position();
            const frameSize = 4 + packetSize;

            // Ensure output buffer capacity
            if (frameSize > this._outputBuffer.length) {
                this._outputBuffer = new Uint8Array(frameSize * 2);
                this._outputView = new DataView(this._outputBuffer.buffer);
            }

            // Write length prefix
            this._outputView.setUint32(0, packetSize);
            // Copy packet into frame buffer
            this._outputBuffer.set(out.toByteArrayView(0, packetSize), 4);

            // Always return an owned frame buffer. Reuse is limited to the staging
            // area inside PacketEncoder; the returned bytes are not shared.
            const frame = new Uint8Array(frameSize);
            frame.set(this._outputBuffer.subarray(0, frameSize));
            return frame;
        } finally {
            bufferPool.return(out);
        }
    }
}
```

**Expected improvement:** ~20-40ns per operation from reusing the staging buffer and its `DataView`. This is smaller than a full zero-copy approach, but it is safe and fully implementable without socket lifecycle assumptions.

**Risk:** Low-Medium. The returned frame is still uniquely owned, so the only risk is incorrect staging-buffer growth logic.

**Test strategy:**
- Benchmark staging-buffer reuse vs fresh frame assembly
- Stress test at high throughput to catch any corruption
- Full test suite

**Rollback:** Allocate fresh `Uint8Array` per encode (current pattern).

---

### Phase 3 Summary

| Change | ns/op Saved | Risk |
|--------|----------:|------|
| 3.1 BufferPool | 100-400 ns | Medium |
| 3.2 Promise chain reduction | 390 ns | Medium |
| 3.3 Invocation entry pooling | 30-50 ns | Low-Med |
| 3.4 Frame buffer reuse | 50-80 ns | Medium |
| **Total Phase 3 savings** | **~570-920 ns** | |

**Expected throughput after Phase 3:** Per-op overhead now ~100-150ns (down from original 783ns). With reduced wire size from Phase 2, expected: **100-150k ops/s**.

---

## Phase 4: Outbound Batching (3-4 hours)

### Objective

Match Hazelcast's `PacketEncoder` batching behavior: instead of calling `socket.write()` for every individual operation, accumulate multiple encoded packets into a single write buffer and flush with one syscall. This reduces syscall overhead from ~1us per `write()` to ~1us per batch of N operations.

### Dependencies

- Phase 2 (binary protocol) — batching binary frames is simpler and more efficient than batching JSON
- Phase 3 (buffer pooling) — the batch buffer uses the same pool helpers and buffer lifecycle conventions

### Risk Level: Medium

Batching introduces latency for the last message in a batch (it waits until the batch flushes). Must implement a flush trigger to bound this latency.

---

### 4.1 Implement Outbound Packet Queue

**File:** `src/internal/eventloop/Eventloop.ts` (or `src/cluster/tcp/TcpClusterTransport.ts`)

**Current behavior:**
```typescript
send(data: Uint8Array): boolean {
    return this._socket.write(data); // one syscall per operation
}
```

**New behavior:**
```typescript
class OutboundBatcher {
    private _batchBuffer: Uint8Array = new Uint8Array(64 * 1024); // 64KB batch buffer
    private _batchView: DataView = new DataView(this._batchBuffer.buffer);
    private _batchOffset: number = 0;
    private _flushScheduled: boolean = false;

    /**
     * Add a frame to the batch buffer.
     * If buffer is full or this is the first frame, schedule a flush.
     */
    enqueue(frame: Uint8Array): boolean {
        // Ensure capacity
        if (this._batchOffset + frame.length > this._batchBuffer.length) {
            this._flush(); // flush current batch before adding
        }

        // Copy frame into batch buffer
        this._batchBuffer.set(frame, this._batchOffset);
        this._batchOffset += frame.length;

        // Schedule flush on next microtask if not already scheduled
        if (!this._flushScheduled) {
            this._flushScheduled = true;
            queueMicrotask(() => this._flush());
        }

        return true;
    }

    /**
     * Flush the batch buffer to the socket in a single write.
     */
    private _flush(): void {
        this._flushScheduled = false;
        if (this._batchOffset === 0) return;

        const data = this._batchBuffer.subarray(0, this._batchOffset);
        this._socket.write(data); // SINGLE syscall for N operations
        this._batchOffset = 0;
    }
}
```

**Expected improvement:**
- At 50k ops/s, operations arrive in bursts due to event loop batching
- Typical burst: 10-50 operations between event loop turns
- 50 operations * ~1us per `socket.write()` = 50us -> 1 `socket.write()` of ~5KB = 1us
- Net savings: **~49us per burst**, or ~980ns per operation in a batch of 50
- Conservative estimate: **200-500ns per operation** average (not all ops are in large batches)

---

### 4.2 Write-Through Optimization

**Concept:** If there's no contention (`queuedFrames() === 0`, `pendingBytes() === 0`, and the batch buffer is empty), skip batching and write directly through the existing `EventloopChannel.write()` path. This avoids the microtask scheduling overhead for low-contention scenarios.

```typescript
enqueue(frame: Uint8Array): boolean {
    // Write-through: if both batching and Eventloop queue are idle, write directly.
    if (
        this._batchOffset === 0
        && this._channel.queuedFrames() === 0
        && this._channel.pendingBytes() === 0
    ) {
        return this._channel.write(Buffer.from(frame));
    }

    // Otherwise, queue for batching
    this._batchBuffer.set(frame, this._batchOffset);
    this._batchOffset += frame.length;

    if (!this._flushScheduled) {
        this._flushScheduled = true;
        queueMicrotask(() => this._flush());
    }

    return true;
}
```

**This matches Hazelcast's pattern:** In Hazelcast, if `writeQueue` is empty and the channel is writable, the calling thread does `PacketEncoder.encode() + socketChannel.write()` directly — no NIO thread involvement. This is the "write-through" optimization that avoids thread handoff for the common case.

**Expected improvement:** Under low load, saves the microtask scheduling overhead (~200ns). Under high load, the batching path dominates.

**Risk:** Low. The write-through path uses the same `EventloopChannel.write()` contract as the rest of the transport, so there is no new socket API dependency.

---

### 4.3 Flush Strategy

Three flush triggers (all implemented):

1. **Microtask flush** (4.1): Flush on next microtask after first enqueue. This batches all operations queued during the current synchronous execution.

2. **Buffer full flush** (4.1): Flush immediately when batch buffer is full. This prevents unbounded memory growth.

3. **Idle flush** (new): If the batch buffer has data and no new operations arrive for 1ms, flush. This bounds worst-case latency.

```typescript
// In enqueue(), after adding to batch:
if (this._idleTimer) clearTimeout(this._idleTimer);
this._idleTimer = setTimeout(() => this._flush(), 1);
```

**Note:** The 1ms idle timer is a safety net. In practice, the microtask flush fires much sooner (~0.01ms). The idle timer only matters when a single operation arrives with no subsequent operations.

**Implementation choice:** Put `OutboundBatcher` in `src/cluster/tcp/TcpClusterTransport.ts`, one batcher per peer channel. Do not modify `EventloopChannel` batching semantics; compose on top of its existing queue rather than replacing it.

---

### Phase 4 Summary

| Change | ns/op Saved | Risk |
|--------|----------:|------|
| 4.1 Outbound batching | 200-500 ns | Medium |
| 4.2 Write-through | 200 ns (low load) | Low |
| 4.3 Flush strategy | Bounds latency | Low |
| **Total Phase 4 savings** | **~200-500 ns** | |

**Expected throughput after Phase 4:** Per-op overhead now ~50-100ns processing + amortized syscall cost. With binary wire format and batching: **120-180k ops/s**.

**Test strategy:**
- Verify single-operation latency is not degraded (write-through should handle this)
- Verify batching actually reduces syscall count (trace `socket.write()` calls)
- Stress test: 4-node cluster, verify throughput improvement and 0 errors
- Latency test: measure p50/p99/p999 latency to ensure batching doesn't add tail latency

**Rollback:** Remove `OutboundBatcher`, revert to direct `socket.write()` per frame.

---

## Phase 5: Scatter Worker Integration (4-6 hours)

### Objective

Determine if `@zenystx/scatterjs` scatter workers can accelerate the binary serialization pipeline. This phase is explicitly gated: implement it only if the benchmark in `5.1` crosses the threshold below. Phases 1-4 remain sufficient for the parity goal.

### Dependencies

- Phase 2 (binary protocol) — must be implemented and benchmarked first
- Phase 3 (buffer pooling) — must be implemented first so the scatter comparison uses the production encode path

### Risk Level: Medium-High

Adding worker threads introduces complexity: data ownership, backpressure, ordering guarantees, error handling across thread boundaries.

---

### 5.1 Decision Gate: Benchmark Binary Serialization

**Before implementing anything in this phase, benchmark:**

```typescript
// Benchmark: binary encode cost for typical SetOperation
const op = new SetOperation('myMap', keyData, valueData);
const out = bufferPool.take();

const start = performance.now();
for (let i = 0; i < 100_000; i++) {
    out.reset();
    op.writeData(out);
    // Include header writing too
    writePacketHeader(out, op);
}
const elapsed = performance.now() - start;
const nsPerOp = (elapsed * 1_000_000) / 100_000;
console.log(`Binary encode: ${nsPerOp} ns/op`);
```

**Decision matrix:**

| Binary encode ns/op | Action |
|--------------------:|--------|
| < 200 ns | Skip Phase 5 entirely. Sync binary is fast enough. |
| 200-500 ns | Marginal. Implement scatter for outbound only, benchmark. |
| > 500 ns | Implement scatter for both outbound encode and inbound decode. |

---

### 5.2 Architecture: Fire-and-Forget Outbound Serialization

**If binary encode > 265ns:**

```
Main Thread                     Scatter Worker
    │                               │
    │  push(op fields as raw)       │
    ├──────────────────────────────>│
    │  [265ns ring buffer push]     │
    │                               │ binary encode op fields
    │                               │ write packet header + payload
    │                               │ push encoded frame to output channel
    │                               │
    │  drain output channel         │
    │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
    │  [batch write to socket]      │
    │                               │
```

**Channel layout:**

```
Main → Worker (structured codec):
  Push a `BinaryEncodeJob` plain object produced by a deterministic switch over
  the supported operation classes

Worker → Main (raw codec):
  Push encoded binary frames (ready for socket.write)
  Main thread drains these on microtask and feeds them to Phase 4 batching
```

**Key design decisions:**

1. **Use raw codec** for worker→main channel (encoded frames are just bytes, no transform needed)
2. **Use structured codec** for main→worker channel (operation fields need to cross thread boundary)
3. **Fire-and-forget push** on main thread (265ns) — do NOT wait for worker response
4. **Drain on microtask** — main thread pulls encoded frames from worker output channel on the next microtask and writes them via the existing batcher
5. **Ordering:** Within a single worker, operations are encoded in order. With multiple workers, ordering across workers is not guaranteed — but this is fine because operations are independent (Hazelcast also doesn't guarantee ordering across NIO output threads)

**Worker count:** Start with 1 worker. If CPU utilization is low and throughput plateaus, add more (up to CPU core count - 1).

---

### 5.3 Implementation Plan

**Files created:**
- `src/cluster/tcp/ScatterOutboundEncoder.ts` — manages scatter worker(s) for outbound encoding

**Files modified:**
- `src/cluster/tcp/TcpClusterTransport.ts` — use `ScatterOutboundEncoder` when scatter is enabled
- `src/cluster/tcp/BinarySerializationStrategy.ts` — extract encode logic into a function callable from worker

**ScatterOutboundEncoder design:**

```typescript
import { scatter } from '@zenystx/scatterjs';

class ScatterOutboundEncoder {
    private _worker: ScatterWorker;
    private _inChannel: Channel; // main → worker (operation fields)
    private _outChannel: Channel; // worker → main (encoded frames)
    private _drainScheduled = false;

    constructor() {
        this._worker = scatter.spawn(
            new URL('./scatter-encoder-worker.ts', import.meta.url),
            {
                channels: {
                    in: { codec: 'structured' }, // Bun.serialize for op fields
                    out: { codec: 'raw' },        // raw bytes for encoded frames
                }
            }
        );
        this._inChannel = this._worker.channels.in;
        this._outChannel = this._worker.channels.out;
    }

    /**
     * Push operation for encoding. Fire-and-forget — 265ns.
     */
    encode(op: IdentifiedDataSerializable, callId: number, partitionId: number): void {
        this._inChannel.push(buildBinaryEncodeJob(op, callId, partitionId));

        if (!this._drainScheduled) {
            this._drainScheduled = true;
            queueMicrotask(() => this._drain());
        }
    }

    /**
     * Drain encoded frames from worker and write to socket.
     */
    private _drain(): void {
        this._drainScheduled = false;
        const frames = this._outChannel.drainSync(); // non-blocking drain
        for (const frame of frames) {
            this._batcher.enqueue(frame); // integrates with Phase 4 batching
        }
    }
}
```

**Worker file:** `src/cluster/tcp/scatter-encoder-worker.ts`

```typescript
// Runs in scatter worker thread
import { channels } from '@zenystx/scatterjs/worker';

const inChannel = channels.in;
const outChannel = channels.out;

// Blocking read loop (worker thread can block)
while (true) {
    const job = inChannel.readBlocking();

    const out = new ByteArrayObjectDataOutput(256);
    writePacketHeader(out, job.callId, job.partitionId, job.flags);
    writeOperationFromJob(out, job);

    const frame = out.toByteArray();
    const framedOutput = new Uint8Array(4 + frame.length);
    new DataView(framedOutput.buffer).setUint32(0, frame.length);
    framedOutput.set(frame, 4);

    outChannel.push(framedOutput);
}
```

**`BinaryEncodeJob` contract:**

The main thread does not rely on hypothetical `toFieldsObject()` methods. It builds a concrete transport DTO per supported operation type.

```typescript
type BinaryEncodeJob =
  | { kind: 'MAP_PUT_OP'; callId: number; partitionId: number; mapName: string; key: Uint8Array; value: Uint8Array; ttl: number; maxIdle: number }
  | { kind: 'MAP_GET_OP'; callId: number; partitionId: number; mapName: string; key: Uint8Array }
  | { kind: 'MAP_REMOVE_OP'; callId: number; partitionId: number; mapName: string; key: Uint8Array }
  | { kind: 'EXECUTOR_CALLABLE_OP'; callId: number; partitionId: number; descriptor: { taskUuid: string; executorName: string; taskType: string; registrationFingerprint: string; inputData: Uint8Array; submitterMemberUuid: string; timeoutMillis: number } }
  // ...one union branch per scatter-supported operation kind
```

`buildBinaryEncodeJob(op, callId, partitionId)` is a switch over known operation classes in the same spirit as the current `OperationWireCodec.serializeOperation()` implementation. `writeOperationFromJob(out, job)` is the matching switch in the worker.

---

### 5.4 Expected Performance

**If binary encode = 300ns (example):**

| Path | Main Thread Cost | Total Latency | Throughput |
|------|----------------:|-------------:|----------:|
| Sync binary | 300 ns | 300 ns | 3.3M ops/s/core |
| Scatter push (fire-forget) | 265 ns | 265 ns main + 300 ns worker | 3.8M ops/s (main freed) |
| Scatter with 2 workers | 265 ns | 265 ns main + 150 ns worker | Main still 265ns bottleneck |

**Net benefit:** Scatter offloads ~35ns from main thread per operation (300-265=35ns). This is marginal. Scatter only becomes compelling if binary encode > 500ns (large payloads, complex operations).

**For large payloads (1KB+ value):** Binary encode may reach 800-1200ns, making scatter channel crossing (265ns) well worth it. The worker encodes in parallel, and the main thread is free to process other operations.

**Recommendation:** Implement as an opt-in feature gated by config. Default to sync binary for small payloads. Enable scatter for workloads with large values.

---

### 5.5 Inbound Decode Offloading

Inbound decode offloading is explicitly out of scope for this plan.

- The main thread keeps inbound decode local
- Scatter workers are used only for outbound encoding when Phase 5 is enabled
- This preserves the single-threaded execution model for decoded operations and avoids introducing a second cross-thread hop on the receive path

---

### Phase 5 Summary

| Scenario | Main Thread Saved | Risk | Recommendation |
|----------|------------------:|------|----------------|
| Binary encode < 200ns | 0 ns (skip phase) | N/A | Skip |
| Binary encode 200-500ns | 35-235 ns | Med-High | Optional, config-gated |
| Binary encode > 500ns | 235+ ns | Med-High | Implement for outbound |
| Inbound decode offloading | Unlikely beneficial | High | Defer |

**Test strategy:**
- Unit test: push operation to worker, drain encoded frame, decode on main thread, verify correctness
- Integration test: 4-node cluster with scatter encoding, verify 0 errors
- Benchmark: compare sync vs scatter at various payload sizes
- Stress test: sustained throughput for 60 seconds, verify no memory leaks or hangs

**Rollback:** Disable scatter via config flag, revert to sync binary path.

---

## Phase 6: Advanced Optimizations (Future)

### Objective

Additional performance improvements that are lower priority, more speculative, or depend on specific workload patterns. These should be tackled after Phases 1-4 (and optionally 5) are proven stable.

### Risk Level: Varies

---

### 6.1 Operation-Specific Fast Paths

**Concept:** The most common operations (`SetOperation`, `GetOperation`) can have hand-optimized encode/decode paths that skip the generic `IdentifiedDataSerializable` dispatch.

```typescript
// Fast path for SetOperation encode:
function encodeSetOperation(out: DataOutput, name: string, key: Data, value: Data, ttl: number): void {
    // Inline header + fields writing, no virtual dispatch
    out.writeByte(0x01); // IDS_FLAG
    out.writeInt(1);     // factoryId = MAP
    out.writeInt(1);     // classId = SET
    // ... rest of fields, all inlined
}
```

**Expected improvement:** ~20-50ns per operation (eliminates virtual dispatch overhead).

**Risk:** Low. Additive optimization — the generic path remains as fallback.

---

### 6.2 Near-Cache Invalidation Batching

**Concept:** Instead of sending one invalidation event per key update, batch invalidations and send them periodically (every 100ms or every N invalidations).

**Files:** Near-cache related files (implementation-dependent)

**Expected improvement:** Reduces network traffic for workloads with near-cache enabled. Does not affect core operation throughput.

**Risk:** Low-Medium. Adds staleness to near-cache (bounded by batch interval).

---

### 6.3 Partition-Aware Connection Routing

**Concept:** Maintain a routing table that maps partition ID -> member connection directly. Currently, routing involves: partition ID -> member ID -> member -> address -> connection. This can be compressed to: partition ID -> connection (single array lookup).

```typescript
// Flat array: partitionConnections[partitionId] = connection
private _partitionConnections: Connection[] = new Array(271);

_updatePartitionTable(table: PartitionTable): void {
    for (let i = 0; i < table.partitionCount; i++) {
        const memberId = table.getOwner(i);
        this._partitionConnections[i] = this._connections.get(memberId)!;
    }
}

// O(1) routing:
_getConnectionForPartition(partitionId: number): Connection {
    return this._partitionConnections[partitionId];
}
```

**Expected improvement:** ~30-60ns per operation (eliminates map lookups in routing).

**Risk:** Low. Must update the flat array on membership/partition changes.

---

### 6.4 Adaptive Batching Based on Load

**Concept:** Dynamically adjust batch buffer size and flush interval based on current throughput:
- Low load (< 10k ops/s): Write-through, no batching (minimize latency)
- Medium load (10-50k ops/s): Small batches (4KB buffer, microtask flush)
- High load (> 50k ops/s): Large batches (64KB buffer, delayed flush)

**Expected improvement:** Optimizes the latency-throughput tradeoff across all load levels.

**Risk:** Medium. Adaptive algorithms can oscillate or make poor decisions during load transitions.

---

### 6.5 Memory-Mapped IMap Backing for Large Datasets

**Concept:** For IMaps that exceed available RAM, back the map with memory-mapped files (Bun supports `Bun.mmap()`). This allows the OS to page data in/out transparently.

**Expected improvement:** Enables datasets larger than RAM without explicit eviction logic.

**Risk:** High. Memory-mapped I/O has unpredictable latency due to page faults.

---

## Cumulative Impact Summary

| Phase | Estimated ns/op Saved | Cumulative ns/op | Expected ops/s | vs Baseline |
|-------|---------------------:|------------------:|---------------:|----------:|
| **Baseline** | — | 783 ns | 41,700 | 1.0x |
| **Phase 1: Quick Wins** | 530-1,260 ns | ~400-550 ns | 50,000-65,000 | 1.2-1.6x |
| **Phase 2: Binary Protocol** | ~1,003 ns | ~150-200 ns | 80,000-120,000 | 1.9-2.9x |
| **Phase 3: Buffer Pooling** | 570-920 ns | ~100-150 ns | 100,000-150,000 | 2.4-3.6x |
| **Phase 4: Outbound Batching** | 200-500 ns | ~50-100 ns | 120,000-180,000 | 2.9-4.3x |
| **Phase 5: Scatter Workers** | 0-235 ns (conditional) | ~50-80 ns | 130,000-200,000 | 3.1-4.8x |
| **Phase 6: Advanced** | 50-160 ns | ~40-70 ns | 140,000-220,000 | 3.4-5.3x |

**Notes on estimates:**
- ns/op savings are not perfectly additive — some savings overlap (e.g., binary protocol eliminates the same JSON cost that TextEncoder partially addressed)
- Throughput estimates assume single-node bottleneck (main thread saturation)
- Actual cluster throughput depends on network latency, partition distribution, and workload mix
- All estimates are for a 4-node cluster with ~54 bytes of actual payload (50B key + 120B value)

### Hazelcast Comparison Point

Hazelcast typically achieves **40,000-60,000 ops/s per node** on equivalent hardware for IMap get/set with similar payload sizes. After completing Phases 1-4, Helios should achieve **30,000-45,000 ops/s per node** (120k-180k / 4 nodes), which is **competitive with or exceeding Hazelcast** — while running on a single-threaded event loop (vs Hazelcast's 6+ NIO threads + N partition threads).

The fundamental advantage is that Bun's event loop can drive ~200k ops/s on a single core when the per-op overhead is low enough, whereas Hazelcast distributes the same work across many threads with synchronization overhead. Helios trades thread parallelism for zero-synchronization efficiency.

---

## Appendix: Key Source Files Reference

| File | Role | Phases Affected |
|------|------|----------------|
| `src/cluster/tcp/TcpClusterTransport.ts` | TCP transport, `_sendMsg()`, `_onData()` | 1.2, 2.6, 4.1 |
| `src/cluster/tcp/SerializationStrategy.ts` | `JsonSerializationStrategy` | 1.1, 2.4 |
| `src/cluster/tcp/ScatterSerializationStrategy.ts` | Scatter pool-based (unused) | 5.3 |
| `src/cluster/tcp/ClusterMessage.ts` | TypeScript message type defs | 2.4 |
| `src/spi/impl/operationservice/OperationWireCodec.ts` | `serializeOperation()`, base64 | 2.4, 2.5 |
| `src/instance/impl/HeliosInstanceImpl.ts` | `remoteSend`, `_handleRemoteOperation`, `setTimeout` | 1.3, 1.4, 3.2, 3.3 |
| `src/internal/eventloop/Eventloop.ts` | Bun socket wrapper, `_writeQueue`, `_flushQueue()` | 4.1, 4.2 |
| `src/internal/serialization/impl/SerializationServiceImpl.ts` | `toData()`, buffer pool | 3.1 |
| `src/internal/serialization/impl/HeapData.ts` | Binary data container | 2.2, 2.5 |
| `src/internal/serialization/impl/ByteArrayObjectDataOutput.ts` | Binary output stream | 2.5, 3.1 |
| `src/internal/serialization/impl/ByteArrayObjectDataInput.ts` | Binary input stream | 2.5 |
| `src/spi/impl/operationservice/impl/OperationServiceImpl.ts` | `invokeOnPartition()` | 3.2 |
| `src/spi/impl/operationservice/InvocationRegistry.ts` | Call ID management | 1.3 |
| `src/spi/impl/operationservice/Invocation.ts` | Promise chain | 3.2 |
| `src/spi/impl/operationservice/InvocationFuture.ts` | Promise chain | 3.2 |
| `src/map/impl/MapProxy.ts` | `set()`, `get()`, `_invokeOnKeyPartition()` | 1.5 |
| `src/map/impl/operation/SetOperation.ts` | Set operation | 2.5 |
| `src/map/impl/operation/GetOperation.ts` | Get operation | 2.5 |

### Test Commands

```bash
# Run full test suite
bun test

# Run specific test file
bun test test/internal/eventloop/Eventloop.test.ts

# Run cluster integration tests
bun test test/cluster/tcp/OwnerRoutedMapTest.test.ts

# Expected: 4776 pass, 15 skip, 0 fail
```

---

*This plan is a living document. Update it as phases are completed, benchmarks are collected, and decisions are refined.*
