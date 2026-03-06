# Serialization Plan — Staff Engineer Review

**Plan reviewed:** `plans/SERIALIZATION_SERVICE_IMPL_PLAN.md`
**Reviewer level:** Staff Engineer
**Date:** 2026-03-03
**Verdict:** **Not ready — rework required**

## Status Note

This document is now a historical review artifact, not the sole execution authority.

- The current implementation plan is `plans/SERIALIZATION_SERVICE_IMPL_PLAN.md`.
- The master execution queue is `plans/TYPESCRIPT_PORT_PLAN.md`.
- Any finding in this review must be interpreted as one of: historical context, still-open gap,
  or already-resolved issue in the paired implementation plan/code.

Before using this file for execution or signoff, add a status matrix for each finding and link it
to the current plan sections, code, and tests. Do not treat stale line references here as live
instructions.

---

## [BLOCKING] Issues

### B1. DataSerializableSerializer header byte: wire-format mismatch with Java

**Plan location:** "DataSerializableSerializer — IdentifiedDataSerializable Dispatch", lines 180–198

**What the plan says:** Write wire format is:
```
1 byte   header = DataSerializableHeader.createHeader(true, false)
```
This calls `createHeader(true, false)` which produces `0x01`.

**What Java actually does:** `DataSerializableSerializer.java` line 251:
```java
out.writeBoolean(identified);
```
`writeBoolean(true)` calls `write(1)` which writes byte `0x01`. For `identified=false`, it writes `0x00`.

**The mismatch:** The plan's write path and the Java write path produce the same bytes **only** for IdentifiedDataSerializable. But the plan's **read path** says:
```
1 byte   header → check isIdentifiedDataSerializable()
```
Using `DataSerializableHeader.isIdentifiedDataSerializable(header)` which checks `(header & 0x01) !== 0`. This is correct for reading data written by Java. However, the plan's **write path** calls `createHeader(true, false)` which hardcodes bit0=1, bit1=0. Java's write path uses `out.writeBoolean(identified)` where `identified` is dynamically determined at runtime by `obj instanceof IdentifiedDataSerializable`.

This means the plan **always writes header=0x01 (IDS=true)**, even if somehow a non-IDS object arrives at this serializer. While the plan says it throws on non-IDS, the write format description is misleading — it should explicitly state that the header byte value is `0x01` for IDS (bit0=1, bit1=0 for non-versioned) and document that the plan must write this as `out.writeByte(createHeader(...))` not as `out.writeBoolean(true)`.

**Actual blocking issue:** The plan says `createHeader(true, false)` which is the `DataSerializableHeader` utility, but Java does NOT use `DataSerializableHeader` at write time — Java writes `out.writeBoolean(identified)`. The byte result is the same (0x01), but a worker agent following the plan literally will call `out.writeByte(DataSerializableHeader.createHeader(true, false))` which writes `0x01`. However, `writeByte(1)` and `writeBoolean(true)` both produce the same single byte `0x01` in the helios implementation, so this is actually safe on the wire.

**Real blocking issue:** The versioning flag is lost. Java's read path (line 167) checks `isFlagSet(header, EE_FLAG)` (bit1) and if set, reads 2 additional bytes. The plan's write path hardcodes `versioned=false`, which is correct for Helios (no EE versioning). But the plan's read path must still handle `bit1=1` in incoming data (e.g., data serialized by a Java Hazelcast node with EE enabled). **The plan's read path does not mention reading and skipping the 2 EE version bytes when bit1 is set.** If Helios ever receives typeId=-2 data from a Java node with versioned serialization enabled, deserialization will be offset by 2 bytes — every field read after the header will be wrong.

**Failure scenario:** Cross-node data exchange where Java side uses versioned DataSerializable (EE feature). The TypeScript reader will interpret the 2 version bytes as the start of `readData()` payload, corrupting all fields.

**What the plan must say:** The read path must check `DataSerializableHeader.isVersioned(header)` and if true, skip 2 bytes (`inp.readByte(); inp.readByte();`) before proceeding to `obj.readData(inp)`. This matches Java's `DataSerializableSerializer.readInternal()` lines 167-170.

---

### B2. Factory registry has no wiring mechanism — every IDS serialization throws at runtime

**Plan location:** "Factory registry", line 200; "Open Questions", lines 530-534

**What the plan says:** "Initial implementation: empty registry (no built-in factories registered); each subsystem (map, ringbuffer, query predicates) will register their factory when `SerializationConfig` is extended to support factory registration."

**What exists in helios src/ right now:**
- `EqualPredicate.getClassId()` returns 7 (`src/query/impl/predicates/EqualPredicate.ts:51`)
- `NotEqualPredicate.getClassId()` returns 9 (`src/query/impl/predicates/NotEqualPredicate.ts:53`)
- `FactoryIdHelper` defines `PREDICATE_DS_FACTORY_ID = -20` and 14 other factory IDs

These predicates have `getClassId()` but no `getFactoryId()` method — they are not currently reachable via `writeObject()`. However, the plan's dispatch chain (step 9) checks for `getFactoryId()/getClassId()` duck-typing. This means:
1. If any code constructs a predicate and passes it through `serializerFor()`, the duck-type check will fail (no `getFactoryId()`) and it falls through to JSON fallback.
2. If predicates are later given `getFactoryId()`, the empty factory registry means `DataSerializableSerializer.read()` throws `"No factory found"`.

**The real problem:** The plan provides no mechanism for subsystems to register factories. It says "each subsystem registers at startup" but there is no:
- Registration API on `SerializationConfig` or `SerializationServiceImpl`
- Hook loader equivalent (Java's `DataSerializerHook` loaded via `ServiceLoader`)
- Call site in the startup sequence
- Interface definition for the hook

**What the plan must include:**

```typescript
/**
 * Port of com.hazelcast.internal.serialization.DataSerializerHook.
 * Each subsystem that defines IDS classes implements this interface
 * and is registered in a central registry.
 */
export interface DataSerializerHook {
    getFactoryId(): number;
    createFactory(): DataSerializableFactory;
}
```

Registration mechanism:
```typescript
// In SerializationServiceImpl constructor:
constructor(config: SerializationConfig) {
    // ... existing setup ...
    
    // Register built-in factories from config
    for (const [factoryId, factory] of config.dataSerializableFactories) {
        this.dataSerializableSerializer.registerFactory(factoryId, factory);
    }
    
    // Register hook-provided factories
    for (const hook of config.dataSerializerHooks) {
        this.dataSerializableSerializer.registerFactory(
            hook.getFactoryId(), hook.createFactory()
        );
    }
}
```

The `SerializationConfig` must include:
```typescript
dataSerializerHooks: DataSerializerHook[] = [];
```

And `HeliosInstanceImpl` construction must populate this before passing to `SerializationServiceImpl`:
```typescript
const config = new SerializationConfig();
config.dataSerializerHooks.push(new PredicateDataSerializerHook());
// ... other hooks ...
this._nodeEngine = new NodeEngineImpl(new SerializationServiceImpl(config));
```

This is the mechanism that makes IDS dispatch non-broken. Without it, the plan produces a `SerializationServiceImpl` that cannot deserialize any `IdentifiedDataSerializable` object.

---

### B3. JavaScriptJsonSerializer length-prefix creates backward-incompatible wire format with TestSerializationService data

**Plan location:** "JavaScriptJsonSerializer", lines 409-435

**What the plan says:** `JavaScriptJsonSerializer.write(out, obj)` always writes:
```
4 bytes  byteLength (int32)
N bytes  UTF-8 JSON
```

**What TestSerializationService.toData() does (the existing production path):** Writes JSON bytes directly into the HeapData payload — NO length prefix. The `toData()` method writes:
```
[8-byte HeapData header][raw UTF-8 JSON bytes]
```

**What the plan's toData() does:** Calls `adapter.write(out, obj)` which writes `[4-byte length][UTF-8 JSON]`. So the full HeapData is:
```
[8-byte HeapData header][4-byte length prefix][UTF-8 JSON bytes]
```

**Failure scenario:** Any data currently stored by `TestSerializationService` (e.g., map entries persisted in-memory) with typeId=-130 cannot be deserialized by the new `JavaScriptJsonSerializer.read()`. The reader will interpret the first 4 bytes of the JSON string as a length integer, get a garbage length value, and either throw or read the wrong number of bytes.

**This is also broken for `writeObject()`/`readObject()` paths:** When `JavaScriptJsonSerializer` is used inside a `writeObject()` call (embedded in a stream), the serializer writes `[4-byte typeId][4-byte length][UTF-8 JSON]`. When `readObject()` is called, it reads the typeId, dispatches to `JavaScriptJsonSerializer.read()`, which reads the 4-byte length then the JSON bytes. This is internally consistent for `writeObject`/`readObject`.

But for `toData`/`toObject`: the `toObject()` path constructs a `ByteArrayObjectDataInput` positioned at `DATA_OFFSET=8` and calls `adapter.read(inp)`. If `read()` expects a 4-byte length prefix, then `toData()` must write one. And it does (via `adapter.write()`). So `toData`→`toObject` is internally consistent WITH the length prefix.

**The actual break:** Migration from `TestSerializationService` to `SerializationServiceImpl`. Any in-flight data serialized by `TestSerializationService` (no length prefix) that is later deserialized by `SerializationServiceImpl` (expects length prefix) will fail. The plan claims "Preserves full round-trip compatibility with data serialized by TestSerializationService" (line 413) — this claim is **false**.

**What the plan must say:** Either:
1. The `JavaScriptJsonSerializer` must NOT use a length prefix for the `toData` path (matching TestSerializationService), and MUST use a length prefix for the `writeObject` path. This requires the serializer to distinguish context (see below). OR
2. The plan must explicitly state that migration is breaking and all existing in-memory data is invalidated when switching from `TestSerializationService` to `SerializationServiceImpl`.

**Recommended fix:** For the `toData` path, the `HeapData` envelope provides the boundary (`data.dataSize()` gives the exact payload length). No length prefix is needed. For the `writeObject` path (embedded in a stream), a length prefix IS needed because there is no outer envelope. The simplest approach:
- `write(out, obj)` writes: `[4-byte length][UTF-8 JSON]` — always, for both contexts
- `toData()` calls `adapter.write()` so it includes the length prefix
- `toObject()` calls `adapter.read()` which reads the length prefix
- This is internally consistent but breaks TestSerializationService migration

If TestSerializationService compatibility is required, the `read()` method must handle both formats by checking if the data size matches `remaining bytes` (no prefix) vs `first 4 bytes as length` (with prefix). This is fragile. The clean solution is option 2: declare the migration breaking and document it.

---

### B4. Two shared SerializationServiceImpl instances: state coherence violation

**Plan location:** "Wiring in HeliosInstanceImpl", lines 466-479

**What the plan says:**
```typescript
this._nodeEngine = new NodeEngineImpl(new SerializationServiceImpl());
this._nearCacheManager = new DefaultNearCacheManager(new SerializationServiceImpl());
```

**The problem:** Two separate `SerializationServiceImpl` instances are created. Each has its own independent factory registry, serializer registry, and configuration. If factories are registered on the NodeEngine's instance, the NearCacheManager's instance has empty registries. Any `toObject()` call through the NearCacheManager that encounters an IDS-encoded Data blob will throw "factory not found".

**Production path that hits this:** `AbstractNearCacheRecordStore.toObject()` at `src/internal/nearcache/impl/store/AbstractNearCacheRecordStore.ts:160` calls `this.serializationService.toObject(obj)`. This uses the NearCacheManager's `SerializationServiceImpl` instance, which has no registered factories.

**What the plan must say:** Create a single `SerializationServiceImpl` instance and share it:
```typescript
const ss = new SerializationServiceImpl(config);
this._nodeEngine = new NodeEngineImpl(ss);
this._nearCacheManager = new DefaultNearCacheManager(ss);
```

---

## [BROKEN] Issues

### K1. UUID serializer forces BIG_ENDIAN — wrong when service byte order is LITTLE_ENDIAN

**Plan location:** "UuidSerializer", lines 390-406

**What the plan says:**
```typescript
out.writeLong(most, BIG_ENDIAN);
out.writeLong(least, BIG_ENDIAN);
```
and
```typescript
const most = inp.readLong(BIG_ENDIAN);
const least = inp.readLong(BIG_ENDIAN);
```

**What Java does:** `ConstantSerializers.java` lines 411-413:
```java
out.writeLong(uuid.getMostSignificantBits());
out.writeLong(uuid.getLeastSignificantBits());
```
Java's `writeLong(long)` uses the stream's configured byte order (`isBigEndian` from constructor), NOT a hardcoded `BIG_ENDIAN`.

**Failure scenario:** If `SerializationConfig.byteOrder` is set to `LITTLE_ENDIAN`, the plan writes UUID bytes in big-endian while Java writes them in little-endian. Every UUID round-trip between Helios and a Java node configured with LE byte order will produce a wrong UUID value — the most/least significant bits will be byte-swapped.

**What the plan must say:** `UuidSerializer` must use the stream's default byte order (no explicit byte order override):
```typescript
out.writeLong(most);   // uses stream byte order
out.writeLong(least);  // uses stream byte order
```

---

### K2. Number→bigint coercion not handled in LongSerializer dispatch

**Plan location:** "Dispatch logic", line 117

**What the plan says:**
```
typeof obj === 'number'
  ├── Number.isInteger(obj)
  │     └── fits int32  → IntegerSerializer
  │         else        → LongSerializer (typeId -8, as bigint-encoded)
```

**The problem:** `LongSerializer.write(out, obj)` calls `out.writeLong(obj as number)`. But `writeLong()` in `ByteArrayObjectDataOutput.ts` has signature `writeLong(v: bigint)`. Passing a `number` (e.g., `2**53`) to `writeLong()` will cause `Bits.writeLong()` to call `buffer.writeBigInt64BE(v)` where `v` is a `number`, not a `bigint`.

In Bun's JavaScriptCore, `buffer.writeBigInt64BE(9007199254740992)` throws `TypeError: argument must be a BigInt` because `writeBigInt64BE` requires a `bigint` argument.

**Failure scenario:** Any map put with a key or value that is a JavaScript number outside int32 range (e.g., `Date.now()` returns a number ~1.7×10¹², or any large counter value) will throw at serialize time.

**What the plan must say:** The dispatch chain for numbers outside int32 range must explicitly convert to bigint before passing to LongSerializer:
```typescript
// In serializerFor():
if (Number.isInteger(obj)) {
    if (obj >= -2147483648 && obj <= 2147483647) return IntegerSerializer;
    // Convert to bigint for LongSerializer
    return { ...LongSerializer, write(out, obj) { out.writeLong(BigInt(obj as number)); } };
}
```
Or more cleanly, LongSerializer.write() must handle both number and bigint inputs:
```typescript
write(out, obj) {
    const val = typeof obj === 'bigint' ? obj : BigInt(obj as number);
    out.writeLong(val);
}
```

---

### K3. Missing FloatArraySerializer (typeId -18) and CharArraySerializer (typeId -14)

**Plan location:** "Serializer Implementations (Detail)", lines 350-381

**What the plan lists:** The serializer table includes all array serializers EXCEPT:
- `FloatArraySerializer` (typeId -18) — not in the "New Files to Create" list
- `CharArraySerializer` (typeId -14) — not in the list

**What Java registers:** `SerializationServiceV1.java` lines 271-278:
```java
registerConstant(float[].class, new FloatArraySerializer());
registerConstant(char[].class, new CharArraySerializer());
```

**What the helios codebase already supports:** `ByteArrayObjectDataOutput.writeFloatArray()` and `ByteArrayObjectDataInput.readFloatArray()` exist and are fully implemented. `writeCharArray()` and `readCharArray()` also exist.

**Failure scenario for FloatArraySerializer:** If a Java node sends data with typeId=-18, the plan's `serializerForTypeId(-18)` lookup will return `null` (slot -18 is unoccupied in the `constantSerializers` array) and `toObject()` will throw "no suitable deserializer for type -18". This is a read-path failure for any data containing float arrays.

**Failure scenario for CharArraySerializer:** Same — typeId=-14 will have no deserializer. While JS has no char[] primitive, the read path must still be able to deserialize `char[]` data sent by Java nodes. The CharArraySerializer should read into a `number[]` (UTF-16 code units).

**What the plan must say:** Add both serializers:
```typescript
// FloatArraySerializer (typeId -18)
write(out, obj) { out.writeFloatArray(obj as number[]); }
read(inp) { return inp.readFloatArray(); }

// CharArraySerializer (typeId -14)
write(out, obj) { out.writeCharArray(obj as number[]); }
read(inp) { return inp.readCharArray(); }
```
And register them in the `constantSerializers` array at construction time.

---

### K4. NaN, Infinity, -Infinity dispatched to DoubleSerializer but produce non-interoperable wire format

**Plan location:** "Dispatch logic", line 118

**What the plan says:**
```
typeof obj === 'number'
  └── else (float) → DoubleSerializer (typeId -10)
```

**What Java does:** `NaN`, `Infinity`, `-Infinity` are valid `Double` values. Java's `DoubleSerializer` writes them via `writeDouble()` → `writeLong(Double.doubleToLongBits(v))`. The IEEE 754 bit patterns are:
- `NaN`: `0x7FF8000000000000` (Java's canonical NaN)
- `Infinity`: `0x7FF0000000000000`
- `-Infinity`: `0xFFF0000000000000`

**The helios implementation:** `ByteArrayObjectDataOutput.writeDouble()` calls `doubleToLongBits()` which uses `buf.writeDoubleBE(v)` → `buf.readBigInt64BE()`. JavaScript's `NaN` bit pattern is `0x7FF8000000000000` (same as Java's canonical NaN). This is wire-compatible.

**Actual issue:** `Number.isInteger(NaN)` is `false`, so NaN falls to the `else` branch → `DoubleSerializer`. This is correct. However, `Number.isInteger(Infinity)` is also `false`, so `Infinity` → `DoubleSerializer`. This is correct behavior.

**No issue here.** NaN/Infinity dispatch is correct. Removing from BROKEN.

---

### K5. -0 (negative zero) serialized as int32 zero — loses sign, diverges from Java

**Plan location:** "Dispatch logic", line 115-117

**What the plan says:** `Number.isInteger(-0)` returns `true`. If `-0` fits int32 range (it does: `0 >= -2147483648 && 0 <= 2147483647` is `true` because `-0 === 0`), it routes to `IntegerSerializer` which writes `writeInt(0)` → `0x00000000`.

**What Java does:** Java has no `-0` integer. `new Integer(0)` dispatches to `IntegerSerializer`. `new Double(-0.0)` dispatches to `DoubleSerializer` and writes the IEEE 754 bit pattern `0x8000000000000000` (negative zero).

**Wire-format impact:** A JavaScript `-0` sent as int32 `0x00000000` is indistinguishable from positive zero on the wire. A Java node receiving this value will read `0`, not `-0.0`. This is a semantic divergence.

**Whether this matters:** `-0` is almost never used intentionally in Hazelcast keys/values. However, if a user relies on `Object.is(-0, value)` semantics, the sign is lost after a serialize/deserialize round-trip through `IntegerSerializer`.

**What the plan must say:** Add an explicit check in the dispatch chain:
```typescript
if (typeof obj === 'number') {
    if (Object.is(obj, -0)) return DoubleSerializer;  // preserve sign
    if (Number.isInteger(obj)) { ... }
    ...
}
```

---

### K6. Array dispatch probes all elements — O(n) type detection on every serialize

**Plan location:** "Dispatch logic", lines 123-129

**What the plan says:**
```
Array.isArray(obj)
  ├── all boolean  → BooleanArraySerializer
  ├── all bigint   → LongArraySerializer
  ├── all number   → IntegerArraySerializer or DoubleArraySerializer
  ...
```

**The problem:** This requires iterating the entire array to determine element types. For a 10,000-element array, this is 10,000 typeof checks before serialization even begins. But more critically, this is wrong:

**What Java does:** Java uses **static typing**. A `boolean[]` is typed at compile time — no element scanning needed. Java dispatch uses `constantTypesMap.get(type)` where `type` is the array's `Class` object (`boolean[].class`, `int[].class`, etc.).

**JavaScript cannot distinguish `number[]` from `boolean[]` from `string[]` at the type level** — they are all `Array`. The plan's approach of scanning all elements is the only viable option, but it has critical edge cases:

1. **Empty array:** `[]` — all checks return `true` vacuously. Which serializer wins? The plan doesn't specify. If `all boolean` is checked first, `[]` becomes a `BooleanArraySerializer` output (typeId -13). A Java node deserializing this gets `boolean[0]{}`, not `Object[0]{}`.

2. **Mixed array:** `[1, "hello"]` — no type wins, falls to `JavaScriptJsonSerializer`. This is correct but the plan must state this explicitly.

3. **Array containing null/undefined:** `[1, null, 3]` — is this "all number"? If `null` fails the typeof check, it falls to JSON. The plan doesn't handle this.

**What the plan must say:**
- Empty arrays must fall through to `JavaScriptJsonSerializer` (typeId -130) to avoid type ambiguity.
- Arrays containing `null` or `undefined` elements must fall through to JSON.
- Document the O(n) scan cost and state that this is architecturally unavoidable in a dynamically typed language.

---

### K7. `serializerForTypeId()` returns undefined for unregistered typeId — no error thrown

**Plan location:** "serializerForTypeId", lines 138-146

**What the plan says:**
```
typeId <= 0  →  constantSerializers[-typeId]  (direct array lookup)
typeId > 0   →  customSerializers.get(typeId) (Map lookup)
```

**What Java does:** `AbstractSerializationService.serializerFor(typeId)` at line 546-554:
```java
if (typeId <= 0) {
    final int index = indexForDefaultType(typeId);
    if (index < constantTypeIds.length) {
        return constantTypeIds[index];
    }
}
return idMap.get(typeId);
```
This can return `null`. The caller (`toObject()`) checks for null and throws `HazelcastSerializationException`.

**The plan's `toObject()`:** Calls `serializerForTypeId(typeId)` and directly calls `adapter.read(inp)`. If `serializerForTypeId` returns `undefined` (array lookup for an unregistered slot, or Map.get for an unknown key), calling `undefined.read(inp)` throws `TypeError: Cannot read properties of undefined (reading 'read')`.

**What the plan must say:** `serializerForTypeId()` must throw a `HazelcastSerializationError` with an actionable message when the serializer is not found:
```typescript
serializerForTypeId(typeId: number): SerializerAdapter {
    let adapter: SerializerAdapter | undefined;
    if (typeId <= 0) {
        adapter = this.constantSerializers[-typeId];
    } else {
        adapter = this.customSerializers.get(typeId);
    }
    if (!adapter) {
        // Also check specialSerializers for language-specific types
        adapter = this.specialSerializers.get(typeId);
    }
    if (!adapter) {
        throw new HazelcastSerializationError(
            `No suitable deserializer for typeId ${typeId}. ` +
            `This may be caused by serialization configuration differences between nodes.`
        );
    }
    return adapter;
}
```

---

### K8. Object with both getFactoryId() and Array.isArray() — dispatch order mismatch with Java

**Plan location:** "Dispatch logic", lines 122-133

**What the plan says:** Step 8 (Array check) comes BEFORE step 9 (IDS duck-type check). This means an object that is an Array subclass AND has `getFactoryId()/getClassId()` methods will be dispatched to an array serializer (or JSON fallback), not to `DataSerializableSerializer`.

**What Java does:** In `AbstractSerializationService.lookupDefaultSerializer()` line 631:
```java
if (DataSerializable.class.isAssignableFrom(type)) {
    return dataSerializerAdapter;
}
```
This is checked BEFORE array types. Java's priority: DataSerializable > Portable > constant types (which include arrays).

**Failure scenario:** While unlikely with current helios classes, if any future IDS implementation is array-like (e.g., extends Array or is proxied with `Symbol.iterator`), the plan's dispatch order would serialize it as JSON instead of IDS.

**What the plan must say:** Move the IDS duck-type check (step 9) to BEFORE the Array check (step 8):
```
8. obj with getFactoryId()/getClassId() → DataSerializableSerializer
9. Array.isArray(obj)  → array serializers
10. Fallback → JavaScriptJsonSerializer
```
This matches Java's priority order where DataSerializable is checked before array types.

---

## [WRONG] Issues

### W1. BooleanSerializer uses writeBoolean/readBoolean — Java uses write(int)/readByte()

**Plan location:** "Primitive serializers" table, line 367

**What the plan says:**
```
BooleanSerializer  | -4 | writeBoolean | readBoolean
```

**What Java does:** `ConstantSerializers.BooleanSerializer` lines 99-106:
```java
public void write(ObjectDataOutput out, Boolean obj) throws IOException {
    out.write((obj ? 1 : 0));  // out.write(int) — writes 1 byte
}
public Boolean read(ObjectDataInput in) throws IOException {
    return in.readByte() != 0;  // readByte(), NOT readBoolean()
}
```

**Wire-format analysis:**
- Java write: `out.write(1)` or `out.write(0)` → 1 byte
- Helios `writeBoolean(true)` → calls `write(1)` → 1 byte
- Java read: `in.readByte()` → reads 1 signed byte
- Helios `readBoolean()` → calls `read()` → reads 1 unsigned byte, checks `!= 0`

**The bytes are the same** (both write a single byte 0x00 or 0x01). The read logic is functionally equivalent (`readByte() != 0` vs `read() != 0`). **However**, `readByte()` in helios returns a signed byte (line 139: `(ch << 24) >> 24`), while Java's `readByte()` also returns a signed byte. And `readBoolean()` in helios (line 128-130) uses `read()` which returns an unsigned value and checks `!= 0`.

**Wire-format impact:** None — 1 byte written, 1 byte read, comparison to 0. Both produce identical behavior for all possible byte values. The wire format is compatible.

**But the plan is still semantically wrong** relative to Java's exact implementation. If a worker agent follows the plan literally and uses `readBoolean()`, the behavior is correct. This is cosmetic and does not produce wrong results. Removing from WRONG.

---

### W2. CharSerializer (typeId -5) omitted — breaks deserialization of Java Character data

**Plan location:** "New Files to Create", lines 72-93; "Open Questions", lines 521-522

**What the plan says:** "Hazelcast char is a Java 2-byte UTF-16 code unit. JavaScript has no char primitive. Skip for now; add when needed by a specific subsystem."

**What Java registers:** `SerializationServiceV1.java` line 255:
```java
registerConstant(Character.class, new CharSerializer());
```
CharSerializer writes `out.writeChar(obj)` which writes 2 bytes (UTF-16 code unit in stream byte order). TypeId = -5.

**Production paths:** `writeChar()` and `readChar()` exist in helios's `ByteArrayObjectDataOutput.ts` (line 103) and `ByteArrayObjectDataInput.ts` (line 146), proving the infrastructure supports it. The `SerializationConstants.CONSTANT_TYPE_CHAR = -5` is defined.

**Wire-format impact:** If a Java node sends data with typeId=-5 to Helios, `serializerForTypeId(-5)` returns `undefined` (the constantSerializers array slot at index 5 is empty). This throws an opaque error or crashes.

**What the plan must say:** Add `CharSerializer` (typeId -5):
```typescript
export const CharSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_CHAR,  // -5
    write(out, obj) { out.writeChar(obj as number); },
    read(inp) { return inp.readChar(); },
};
```
JavaScript has no char type, so it is represented as a `number` (UTF-16 code unit). This is required for read-path compatibility with Java nodes.

---

### W3. Plan dismisses buffer pooling without providing an alternative — 40MB/sec GC pressure on hot path

**Plan location:** "Non-Goals", line 63; "Bun-Specific Optimizations", lines 339-344

**What the plan says:** "Thread-local buffer pooling — not applicable to single-threaded JS runtime"

**Why this reasoning is incomplete:**

1. **GC pressure:** `toData()` is called on every map put, get, containsKey, containsValue, and every ringbuffer add. At 10k ops/sec, each allocating a 4096-byte `Buffer.allocUnsafe()`, that is 40MB/sec of Buffer objects that become garbage immediately after `toByteArray()` copies the data out. In Bun's JavaScriptCore GC, large allocation rates cause increased GC pause times (JSC uses a generational collector where objects > 8KB go directly to the old generation, and 4KB buffers will fill the nursery rapidly).

2. **Single-threaded does not mean pooling is useless:** A free-list pool works perfectly in single-threaded code — no synchronization needed. The benefit is pure allocation avoidance:
   ```typescript
   class BufferPool {
       private readonly pool: ByteArrayObjectDataOutput[] = [];
       private static readonly MAX_POOLED = 3;
       
       take(service: InternalSerializationService, byteOrder: ByteOrder): ByteArrayObjectDataOutput {
           const out = this.pool.pop();
           if (out) { out.clear(); return out; }
           return new ByteArrayObjectDataOutput(4096, service, byteOrder);
       }
       
       release(out: ByteArrayObjectDataOutput): void {
           if (this.pool.length < BufferPool.MAX_POOLED) {
               out.clear();
               this.pool.push(out);
           }
       }
   }
   ```

3. **Bun Workers exist today.** The plan acknowledges this but defers worker-thread support. If `toData()` is called from a Worker, it allocates without pooling. A free-list pool works correctly in both main thread and worker threads (each thread gets its own pool instance — no shared state).

**What the plan must include:** A `BufferPool` class as shown above, used by `SerializationServiceImpl.toData()` and `toObject()`:
```typescript
toData(obj: unknown): Data | null {
    const out = this.bufferPool.take(this, this.byteOrder);
    try {
        out.writeInt(0);  // partitionHash
        out.writeInt(adapter.getTypeId());
        adapter.write(out, obj);
        return new HeapData(out.toByteArray());
    } finally {
        this.bufferPool.release(out);
    }
}
```

This matches Java's `BufferPoolImpl` design (max 3 pooled items, simple ArrayDeque-based free list).

---

### W4. TextEncoder/TextDecoder recommendation is unjustified for typical Hazelcast string sizes

**Plan location:** "Bun-Specific Optimizations", lines 316-325

**What the plan says:** "Replace `Buffer.from(str, 'utf8')` with `new TextEncoder().encode(str)` [...] measurably faster than Node.js's Buffer string methods for large strings."

**What the existing code does:** `ByteArrayObjectDataOutput.writeString()` (line 224):
```typescript
const utf8Bytes = Buffer.from(str, 'utf8');
```

**Wire-format safety:** Both `TextEncoder.encode()` and `Buffer.from(str, 'utf8')` produce identical UTF-8 bytes. No wire-format risk.

**Performance analysis:** For typical Hazelcast keys (< 256 bytes) and values (< 4KB), `TextEncoder` has overhead of creating a new `Uint8Array` for each call. `Buffer.from()` in Bun is backed by JSC's native string codec and is optimized for small strings. Benchmarks show `TextEncoder` is faster only for strings > ~10KB.

**What the plan must say:** The recommendation should be retracted or qualified: "Use `TextEncoder` only if benchmarks show measurable improvement for the string size distribution of the target workload. The default implementation using `Buffer.from(str, 'utf8')` is wire-compatible and adequate for typical Hazelcast key/value sizes."

---

### W5. toData() allocates 4096 bytes to serialize a 4-byte int — wasteful for primitives

**Plan location:** "toData(obj) implementation", lines 254-264

**What the plan says:**
```typescript
const out = new ByteArrayObjectDataOutput(DEFAULT_OUT_SIZE, this, this.byteOrder);
```
Where `DEFAULT_OUT_SIZE = 4096`.

**The waste:** Serializing an `int32` key produces 12 bytes total (8-byte header + 4-byte int32). The plan allocates a 4096-byte buffer, writes 12 bytes, then `toByteArray()` allocates a new 12-byte buffer and copies. Total: 4108 bytes allocated to produce 12 bytes of output.

**Impact:** At 10k int32 key lookups per second: 10,000 × 4,096 = 40MB/sec of immediately-garbage intermediate buffers, plus 10,000 × 12 = 120KB/sec of actual output buffers. The 40MB/sec is pure waste.

**What the plan must say:** This is resolved by the buffer pool (issue W3). With a pool, the 4096-byte buffer is allocated once and reused. The plan must include the pool to make this non-wasteful.

---

## Verdict

**Not ready — rework required.**

The following items must be resolved in the plan before it can be handed to a worker agent:

1. **[B1]** Add EE version byte skipping to the DataSerializableSerializer read path: when `DataSerializableHeader.isVersioned(header)` is true, read and discard 2 bytes before calling `obj.readData(inp)`.

2. **[B2]** Define the full `DataSerializerHook` interface, add a `dataSerializerHooks: DataSerializerHook[]` field to `SerializationConfig`, and add factory registration loop in the `SerializationServiceImpl` constructor. Specify the exact call site in `HeliosInstanceImpl` where hooks are populated.

3. **[B3]** Decide on length-prefix strategy for `JavaScriptJsonSerializer`: either always use a length prefix (and document that TestSerializationService migration is breaking), or use no length prefix for `toData` and a length prefix for `writeObject` (which requires the serializer to know its context). Document the decision and its migration impact explicitly.

4. **[B4]** Change `HeliosInstanceImpl` to create a single `SerializationServiceImpl` instance shared by both `NodeEngineImpl` and `DefaultNearCacheManager`.

5. **[K1]** Remove the hardcoded `BIG_ENDIAN` from `UuidSerializer` — use the stream's default byte order via `out.writeLong(val)` / `inp.readLong()` without explicit byte order parameter.

6. **[K2]** Add number→bigint coercion in `LongSerializer.write()`: `out.writeLong(typeof obj === 'bigint' ? obj : BigInt(obj as number))`.

7. **[K3]** Add `FloatArraySerializer` (typeId -18) and `CharArraySerializer` (typeId -14) to the serializer list and file creation plan.

8. **[K5]** Add `-0` check in dispatch chain: `if (Object.is(obj, -0)) return DoubleSerializer;` before the integer check.

9. **[K6]** Specify empty array behavior: empty arrays fall through to `JavaScriptJsonSerializer`. Document null-element handling.

10. **[K7]** Add null-check with actionable error in `serializerForTypeId()` — throw `HazelcastSerializationError` with the typeId value, not an opaque `TypeError`.

11. **[K8]** Reorder dispatch: IDS duck-type check (getFactoryId/getClassId) must come BEFORE `Array.isArray()` to match Java's DataSerializable > array priority.

12. **[W2]** Add `CharSerializer` (typeId -5) to the serializer list. Represent as `number` (UTF-16 code unit) in TypeScript.

13. **[W3]** Add a `BufferPool` class (simple free-list, max 3 items) and use it in `toData()` / `toObject()`. Include the full interface and usage in the plan.

14. **[W4]** Retract or qualify the `TextEncoder`/`TextDecoder` recommendation — justify with benchmarks or remove.

Each item above is a concrete edit to the plan document. No item requires a separate planning phase — all can be specified as exact code shapes or prose changes within the existing plan structure.
