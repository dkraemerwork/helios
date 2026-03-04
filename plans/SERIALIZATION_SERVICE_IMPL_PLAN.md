# Production SerializationServiceImpl — Implementation Plan

**Replaces:** `TestSerializationService` (temporary placeholder in `HeliosInstanceImpl`)  
**Scheduled as:** Block 7.2+ (referenced in `HeliosInstanceImpl.ts` line 109)  
**Scope:** `src/internal/serialization/impl/` — new files only; no changes to existing interfaces

---

## Background & Context

The Helios serialization layer is a TypeScript port of Hazelcast's
`com.hazelcast.internal.serialization.impl.AbstractSerializationService` /
`SerializationServiceV1`. The existing infrastructure is already complete:

| Existing file | Role |
|---|---|
| `SerializationService.ts` | Public interface (`toData`, `toObject`, `writeObject`, `readObject`, `getClassLoader`) |
| `InternalSerializationService.ts` | Extends above, adds `aClass?` overload to `readObject` |
| `Data.ts` / `HeapData.ts` | Wire-format binary envelope (8-byte header + payload) |
| `ByteArrayObjectDataOutput.ts` | Positional write buffer — calls `service.writeObject()` |
| `ByteArrayObjectDataInput.ts` | Positional read buffer — calls `service.readObject()` |
| `SerializationConstants.ts` | All type IDs (wire protocol — **MUST NOT change**) |
| `DataSerializableHeader.ts` | Header byte constants for DataSerializable |
| `FactoryIdHelper.ts` | Factory ID registry (reads from `process.env`) |
| `TestSerializationService.ts` | JSON-only placeholder — `writeObject`/`readObject` throw |

**Wire format** (`HeapData` layout — fixed, part of Hazelcast network protocol):
```
Offset  Size  Content
0       4     partitionHash (int32, always BIG_ENDIAN)
4       4     typeId        (int32, configurable byte order; default BIG_ENDIAN)
8       N     payload       (serializer-specific)
```

**The two broken production paths today:**
- `ByteArrayObjectDataOutput.writeObject(obj)` → `service.writeObject(this, obj)` → **throws**
- `ByteArrayObjectDataInput.readObject()` → `service.readObject(this)` → **throws**

Both are used whenever a serializer needs to embed a nested arbitrary object inline in a
binary stream (e.g., map entry serializers, operation codecs).

---

## Goals

1. Implement `SerializationServiceImpl` satisfying `InternalSerializationService`
2. Implement the minimum set of built-in serializers needed for production
3. Support `writeObject` / `readObject` (inline embedded object serialization)
4. Provide `SerializationConfig` for future extensibility (custom serializer registration)
5. Wire `HeliosInstanceImpl` to use `SerializationServiceImpl` instead of `TestSerializationService`
6. Leverage Bun-specific APIs where they provide meaningful improvement
7. Keep `TestSerializationService` intact for unit tests that depend on JSON round-trip

---

## Non-Goals (explicitly deferred)

- **Portable serialization** (type ID `-1`) — Java-specific class hierarchy feature
- **Compact serialization** (type IDs `-55`, `-56`) — requires schema management, deferred
- **Java collection type IDs** (`-29` through `-54`) — e.g., `ArrayList`, `HashMap` — not needed until cross-language/cross-version compatibility is required; JS `Map` / `Array` cover the runtime
- **Java serialization fallback** (`-100`, `-101`) — `Serializable`/`Externalizable` — pure Java
- **Custom user serializer registration API** — infrastructure stub only (empty registry), no user-facing builder API in this iteration
- ~~**Thread-local buffer pooling**~~ — **RESOLVED:** a simple free-list `BufferPool` (max 3 items, no synchronization needed) is included in this plan. See the "Buffer pooling via simple free-list" section.
- **`ManagedContext.initialize()`** — dependency injection hook not needed until service injection is implemented
- **Partition strategy / partition hash calculation** — partition hash written as `0` (same as `TestSerializationService`)

---

## New Files to Create

```
src/internal/serialization/impl/
├── serializers/
│   ├── NullSerializer.ts                    # typeId 0
│   ├── JavaScriptJsonSerializer.ts          # typeId -130 (JS default — wraps TestSerializationService logic)
│   ├── ByteSerializer.ts                    # typeId -3
│   ├── BooleanSerializer.ts                 # typeId -4
│   ├── CharSerializer.ts                    # typeId -5  (number — UTF-16 code unit)
│   ├── ShortSerializer.ts                   # typeId -6
│   ├── IntegerSerializer.ts                 # typeId -7
│   ├── LongSerializer.ts                    # typeId -8  (bigint | number → bigint coercion)
│   ├── FloatSerializer.ts                   # typeId -9
│   ├── DoubleSerializer.ts                  # typeId -10
│   ├── StringSerializer.ts                  # typeId -11
│   ├── ByteArraySerializer.ts               # typeId -12
│   ├── BooleanArraySerializer.ts            # typeId -13
│   ├── CharArraySerializer.ts               # typeId -14 (number[] — UTF-16 code units)
│   ├── ShortArraySerializer.ts              # typeId -15
│   ├── IntegerArraySerializer.ts            # typeId -16
│   ├── LongArraySerializer.ts               # typeId -17
│   ├── FloatArraySerializer.ts              # typeId -18
│   ├── DoubleArraySerializer.ts             # typeId -19
│   ├── StringArraySerializer.ts             # typeId -20
│   ├── UuidSerializer.ts                    # typeId -21
│   └── DataSerializableSerializer.ts        # typeId -2  (IdentifiedDataSerializable dispatch)
├── bufferpool/
│   └── BufferPool.ts                        # Simple free-list buffer pool (max 3 items)
├── SerializerAdapter.ts                     # Internal bridge interface (write/read/getTypeId)
├── DataSerializerHook.ts                    # Hook interface for subsystem factory registration
├── SerializationConfig.ts                   # Config object (byte order, hooks, custom serializer list)
└── SerializationServiceImpl.ts              # Main implementation
```

**Files to modify:**
```
src/instance/impl/HeliosInstanceImpl.ts      # swap TestSerializationService → SerializationServiceImpl
```

---

## Serializer Priority & Dispatch Logic

### `serializerFor(obj: unknown): SerializerAdapter` (write path)

Priority order (mirrors Java `AbstractSerializationService.serializerFor()` →
`lookupDefaultSerializer()` where DataSerializable is checked before constant types
including arrays):

```
1. obj === null / undefined          → NullSerializer         (typeId 0)
2. obj instanceof HeapData           → error: use writeData() instead
3. typeof obj === 'number'
     ├── Object.is(obj, -0)          → DoubleSerializer       (typeId -10)
     │                                 (preserve IEEE 754 negative-zero sign bit)
     ├── Number.isInteger(obj)
     │     └── fits int32            → IntegerSerializer      (typeId -7)
     │         (>= -2147483648 && <= 2147483647)
     │         else                  → LongSerializer         (typeId -8)
     │                                 write: BigInt(obj) before writeLong()
     └── else (float/NaN/Infinity)   → DoubleSerializer       (typeId -10)
4. typeof obj === 'bigint'           → LongSerializer         (typeId -8)
5. typeof obj === 'boolean'          → BooleanSerializer      (typeId -4)
6. typeof obj === 'string'           → StringSerializer       (typeId -11)
7. obj instanceof Uint8Array/Buffer  → ByteArraySerializer    (typeId -12)
8. obj with getFactoryId()/getClassId() methods
     (IdentifiedDataSerializable duck-type check — must come BEFORE array
      check to match Java's DataSerializable > constant-type priority)
                                     → DataSerializableSerializer (typeId -2)
9. Array.isArray(obj)
     ├── length === 0                → JavaScriptJsonSerializer (typeId -130)
     │                                 (empty arrays are type-ambiguous — avoid
     │                                  wrong typeId on Java deserialization)
     ├── any element is null/undef   → JavaScriptJsonSerializer (typeId -130)
     ├── all boolean                 → BooleanArraySerializer (typeId -13)
     ├── all bigint                  → LongArraySerializer    (typeId -17)
     ├── all number (int32)          → IntegerArraySerializer (typeId -16)
     ├── all number (float/mixed)    → DoubleArraySerializer  (typeId -19)
     ├── all string                  → StringArraySerializer  (typeId -20)
     └── else (mixed types)          → JavaScriptJsonSerializer (typeId -130)
10. Fallback                         → JavaScriptJsonSerializer (typeId -130)
```

**Array dispatch note:** JavaScript arrays are untyped; dispatch requires an O(n) scan of
all elements to determine the homogeneous type. This is architecturally unavoidable in a
dynamically typed language (Java uses compile-time `Class` identity instead). The scan
short-circuits on the first type mismatch. Empty arrays and arrays containing `null` or
`undefined` always fall through to `JavaScriptJsonSerializer` to avoid type ambiguity.

**LongSerializer coercion note:** When `serializerFor()` routes a JS `number` outside int32
range to `LongSerializer`, the serializer must convert to `bigint` before calling
`writeLong()`:
```typescript
export const LongSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_LONG,   // -8
    write(out, obj) {
        const val = typeof obj === 'bigint' ? obj : BigInt(obj as number);
        out.writeLong(val);
    },
    read(inp) { return inp.readLong(); },
};
```

### `serializerForTypeId(typeId: number): SerializerAdapter` (read path)

```typescript
serializerForTypeId(typeId: number): SerializerAdapter {
    let adapter: SerializerAdapter | undefined;
    if (typeId <= 0) {
        const index = -typeId;
        if (index < this.constantSerializers.length) {
            adapter = this.constantSerializers[index] ?? undefined;
        }
    }
    if (!adapter) {
        adapter = this.specialSerializers.get(typeId);   // language-specific (e.g. -130)
    }
    if (!adapter) {
        adapter = this.customSerializers.get(typeId);    // user-defined (typeId > 0)
    }
    if (!adapter) {
        throw new HazelcastSerializationError(
            `No suitable deserializer for typeId ${typeId}. `
            + 'This is likely caused by serialization configuration differences between nodes.'
        );
    }
    return adapter;
}
```

The `constantSerializers` array is pre-populated at construction time indexed by `-typeId`.
Size = `SerializationConstants.CONSTANT_SERIALIZERS_LENGTH` (57), covering indices 0–56.
Additionally, the language-specific serializers at higher indices (`-130`, etc.) are in a
separate `Map<number, SerializerAdapter>` (`specialSerializers`).

---

## `SerializerAdapter` Interface

```typescript
// src/internal/serialization/impl/SerializerAdapter.ts
export interface SerializerAdapter {
    getTypeId(): number;
    write(out: ByteArrayObjectDataOutput, obj: unknown): void;
    read(inp: ByteArrayObjectDataInput): unknown;
}
```

This is an internal interface only — not exposed publicly. Mirrors Java's
`com.hazelcast.internal.serialization.impl.StreamSerializerAdapter`.

---

## `DataSerializableSerializer` — `IdentifiedDataSerializable` Dispatch

This serializer handles typeId `-2`. The interface contract for objects registered as
IdentifiedDataSerializable (duck-typed, no formal TypeScript interface required):

```typescript
interface IdentifiedDataSerializable {
    getFactoryId(): number;
    getClassId(): number;
    writeData(out: ByteArrayObjectDataOutput): void;
    readData(inp: ByteArrayObjectDataInput): void;
}
```

**Write wire format:**
```
1 byte   header            = DataSerializableHeader.createHeader(true, false)
                             (bit0=1 = IdentifiedDataSerializable, bit1=0 = non-versioned)
4 bytes  factoryId         (int32, stream byte order)
4 bytes  classId           (int32, stream byte order)
N bytes  obj.writeData(out)
```

**Read wire format (reverse):**
```
1 byte   header
         → isIDS = DataSerializableHeader.isIdentifiedDataSerializable(header)
         → if !isIDS: throw HazelcastSerializationError('non-IdentifiedDataSerializable not supported')
4 bytes  factoryId
4 bytes  classId
         → factory = factoryRegistry.get(factoryId)
         → if !factory: throw HazelcastSerializationError('No DataSerializerFactory for namespace: ' + factoryId)
         → obj = factory.create(classId)
         → if !obj: throw HazelcastSerializationError('Factory cannot create instance for classId: ' + classId + ' on factoryId: ' + factoryId)
         → if DataSerializableHeader.isVersioned(header):
              inp.readByte(); inp.readByte();   // skip 2 EE version bytes
         → obj.readData(inp)
         → return obj
```

**EE version byte handling (critical for cross-node compatibility):** Java's
`DataSerializableSerializer.readInternal()` (lines 167-170) checks `isFlagSet(header, EE_FLAG)`
and if set, reads and discards 2 bytes before calling `readData()`. This handles data
serialized by Hazelcast Enterprise Edition nodes with versioned serialization enabled.
The Helios write path always writes `versioned=false` (bit1=0), but the read path MUST
handle `bit1=1` in incoming data to avoid corrupting the deserialized object's fields.

**Factory registry** is passed to `DataSerializableSerializer` at construction via
`SerializationConfig.dataSerializableFactories` and `SerializationConfig.dataSerializerHooks`.
See the "SerializationConfig" and "DataSerializerHook" sections below for the full
registration mechanism.

**Error handling:** All error messages include the factoryId and classId values for
production debuggability. Throw `HazelcastSerializationError` (not generic `Error`).

---

## `DataSerializerHook` Interface

Port of `com.hazelcast.internal.serialization.DataSerializerHook`. Each subsystem that
defines IdentifiedDataSerializable classes implements this interface to register its
factory. This is the TypeScript equivalent of Java's `ServiceLoader`-based hook system.

```typescript
// src/internal/serialization/impl/DataSerializerHook.ts
export interface DataSerializerHook {
    getFactoryId(): number;
    createFactory(): DataSerializableFactory;
}
```

**New file:** `src/internal/serialization/impl/DataSerializerHook.ts`

**Registration call sequence:** During `SerializationServiceImpl` construction, hooks are
iterated and their factories registered into the `DataSerializableSerializer`'s internal
registry. This runs before any `toData()`/`toObject()` call is possible.

```typescript
// In SerializationServiceImpl constructor:
constructor(config: SerializationConfig = new SerializationConfig()) {
    // ... build constantSerializers, specialSerializers, customSerializers ...

    // Register factories from config (user-provided)
    for (const [factoryId, factory] of config.dataSerializableFactories) {
        this.dataSerializableSerializer.registerFactory(factoryId, factory);
    }

    // Register factories from hooks (subsystem-provided)
    for (const hook of config.dataSerializerHooks) {
        this.dataSerializableSerializer.registerFactory(
            hook.getFactoryId(), hook.createFactory()
        );
    }
}
```

---

## `SerializationConfig`

```typescript
// src/internal/serialization/impl/SerializationConfig.ts
export class SerializationConfig {
    byteOrder: ByteOrder = BIG_ENDIAN;
    dataSerializableFactories: Map<number, DataSerializableFactory> = new Map();
    dataSerializerHooks: DataSerializerHook[] = [];
    // Future: customSerializers: Map<number, SerializerAdapter> = new Map();
    // Future: globalSerializer: SerializerAdapter | null = null;
}
```

`DataSerializableFactory` interface:
```typescript
export interface DataSerializableFactory {
    create(classId: number): IdentifiedDataSerializable;
}
```

**Wiring in HeliosInstanceImpl:** The hooks array is populated before constructing
`SerializationServiceImpl`:
```typescript
const serializationConfig = new SerializationConfig();
// Each subsystem registers its hook:
// serializationConfig.dataSerializerHooks.push(new PredicateDataSerializerHook());
// serializationConfig.dataSerializerHooks.push(new MapDataSerializerHook());
// (hooks are added as subsystems are ported — empty initially is safe because
//  no IDS objects are currently serialized in production paths)
const ss = new SerializationServiceImpl(serializationConfig);
```

---

## `SerializationServiceImpl`

```typescript
// src/internal/serialization/impl/SerializationServiceImpl.ts
export class SerializationServiceImpl implements InternalSerializationService {
    private readonly byteOrder: ByteOrder;
    private readonly constantSerializers: (SerializerAdapter | null)[];  // indexed by -typeId
    private readonly specialSerializers: Map<number, SerializerAdapter>; // typeId < -56 (lang-specific)
    private readonly customSerializers: Map<number, SerializerAdapter>;  // typeId > 0 (user-defined)
    private readonly bufferPool: BufferPool;                             // reusable output/input buffers
    private readonly dataSerializableSerializer: DataSerializableSerializer;

    constructor(config: SerializationConfig = new SerializationConfig()) {
        // ... build serializer registries ...
        this.bufferPool = new BufferPool(this, this.byteOrder);
        // ... register factories from config (see DataSerializerHook section) ...
    }

    toData(obj: unknown): Data | null { ... }
    toObject<T>(data: Data | null): T | null { ... }
    writeObject(out: ByteArrayObjectDataOutput, obj: unknown): void { ... }
    readObject<T>(inp: ByteArrayObjectDataInput, aClass?: unknown): T { ... }
    getClassLoader(): null { return null; }   // TypeScript: no class loader concept
}
```

### `toData(obj)` implementation

```typescript
toData(obj: unknown): Data | null {
    if (obj == null) return null;
    if (obj instanceof HeapData) return obj;   // already serialized

    const adapter = this.serializerFor(obj);
    const out = this.bufferPool.takeOutputBuffer();
    try {
        out.writeInt(0);                           // partitionHash = 0 (placeholder)
        out.writeInt(adapter.getTypeId());         // typeId
        adapter.write(out, obj);                   // payload
        return new HeapData(out.toByteArray());
    } finally {
        this.bufferPool.returnOutputBuffer(out);
    }
}
```

`BufferPool` reuses output buffers (max 3 pooled). Default buffer size = 4096 bytes
(matches Java's `DEFAULT_OUT_BUFFER_SIZE`). The pool eliminates ~40MB/sec of garbage
at 10k ops/sec for primitive key serialization.

### `toObject(data)` implementation

```typescript
toObject<T>(data: Data | null): T | null {
    if (data == null) return null;
    const bytes = data.toByteArray();
    if (bytes == null || bytes.length === 0) return null;
    const typeId = data.getType();
    if (typeId === SerializationConstants.CONSTANT_TYPE_NULL) return null;
    const adapter = this.serializerForTypeId(typeId);
    const inp = this.bufferPool.takeInputBuffer(data);
    try {
        return adapter.read(inp) as T;
    } finally {
        this.bufferPool.returnInputBuffer(inp);
    }
}
```

### `writeObject(out, obj)` implementation

```typescript
writeObject(out: ByteArrayObjectDataOutput, obj: unknown): void {
    if (obj instanceof HeapData) {
        throw new Error('HazelcastSerializationError: Cannot writeObject a Data instance — use writeData() instead');
    }
    const adapter = this.serializerFor(obj);
    out.writeInt(adapter.getTypeId());   // typeId prefix (no partitionHash for embedded objects)
    adapter.write(out, obj);
}
```

### `readObject(inp)` implementation

```typescript
readObject<T>(inp: ByteArrayObjectDataInput, _aClass?: unknown): T {
    const typeId = inp.readInt();
    const adapter = this.serializerForTypeId(typeId);
    return adapter.read(inp) as T;
}
```

Note: `aClass` is accepted for interface compatibility but not used (TypeScript has no
class-loader-based instantiation; type dispatch is purely by typeId).

---

## Bun-Specific Optimizations

### 1. String encoding: `Buffer.from(str, 'utf8')` (default)

The existing `ByteArrayObjectDataOutput.writeString()` uses `Buffer.from(str, 'utf8')`
which produces wire-compatible UTF-8 bytes identical to Java's `StringSerializerV2`.
No change is needed.

`TextEncoder`/`TextDecoder` are available in Bun as an alternative, but benchmarks show
they are only faster for strings > ~10KB. Typical Hazelcast keys are < 256 bytes and
values are < 4KB, where `Buffer.from()` (backed by JSC's native string codec) is equal
or faster. The serializer implementations should use `Buffer.from(str, 'utf8')` and
`buffer.toString('utf8')` unless future profiling demonstrates a measurable gain for
the actual workload's string size distribution.

**Applies to:** `StringSerializer`, `StringArraySerializer`.

### 2. Native gzip/deflate for future `JavaSerializer` (not needed in this iteration)

`Bun.gzipSync()` / `Bun.gunzipSync()` will replace `node:zlib` when the optional
`enableCompression` path for `JavaSerializer` (typeId `-100`) is added. Noted here as the
correct future approach; not implemented in this iteration since Java serialization support
is out of scope.

### 3. `Buffer.allocUnsafe` vs `Buffer.alloc`

Continue using `Buffer.allocUnsafe` (already used in `ByteArrayObjectDataOutput`) for
output buffers where we always write before read. Use `Buffer.alloc` (zero-filled) only for
sentinel buffers. Bun's allocator is already optimised for this pattern.

### 4. Buffer pooling via simple free-list

Java's `BufferPoolImpl` uses a per-thread `ArrayDeque` (max 3 items) to reuse output/input
buffers. Helios adopts the same design as a simple free-list — no synchronization needed in
single-threaded JS, and each Bun Worker would get its own pool instance if workers are used.

**New file:** `src/internal/serialization/impl/bufferpool/BufferPool.ts`

```typescript
import type { ByteArrayObjectDataOutput } from '../ByteArrayObjectDataOutput';
import type { ByteArrayObjectDataInput } from '../ByteArrayObjectDataInput';
import type { InternalSerializationService } from '../../InternalSerializationService';
import type { ByteOrder } from '../ByteArrayObjectDataInput';
import type { Data } from '../../Data';
import { HeapData } from '../HeapData';

const MAX_POOLED_ITEMS = 3;
const DEFAULT_OUTPUT_SIZE = 4096;

export class BufferPool {
    private readonly outputPool: ByteArrayObjectDataOutput[] = [];
    private readonly inputPool: ByteArrayObjectDataInput[] = [];
    private readonly service: InternalSerializationService;
    private readonly byteOrder: ByteOrder;

    constructor(service: InternalSerializationService, byteOrder: ByteOrder) {
        this.service = service;
        this.byteOrder = byteOrder;
    }

    takeOutputBuffer(): ByteArrayObjectDataOutput {
        const out = this.outputPool.pop();
        if (out) return out;
        return new ByteArrayObjectDataOutput(DEFAULT_OUTPUT_SIZE, this.service, this.byteOrder);
    }

    returnOutputBuffer(out: ByteArrayObjectDataOutput): void {
        if (out == null) return;
        out.clear();
        if (this.outputPool.length < MAX_POOLED_ITEMS) {
            this.outputPool.push(out);
        }
    }

    takeInputBuffer(data: Data): ByteArrayObjectDataInput {
        const inp = this.inputPool.pop();
        if (inp) {
            inp.init(data.toByteArray(), HeapData.DATA_OFFSET);
            return inp;
        }
        return new ByteArrayObjectDataInput(
            data.toByteArray(), HeapData.DATA_OFFSET, this.service, this.byteOrder
        );
    }

    returnInputBuffer(inp: ByteArrayObjectDataInput): void {
        if (inp == null) return;
        inp.clear();
        if (this.inputPool.length < MAX_POOLED_ITEMS) {
            this.inputPool.push(inp);
        }
    }
}
```

`BufferPool` is instantiated in `SerializationServiceImpl` constructor and used in
`toData()` and `toObject()`. See the `SerializationServiceImpl` section for usage.
This eliminates ~40MB/sec of garbage from per-call 4096-byte buffer allocation at 10k ops/sec.

---

## Serializer Implementations (Detail)

### Primitive serializers

All follow this shape:
```typescript
// Example: IntegerSerializer
export const IntegerSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.CONSTANT_TYPE_INTEGER,   // -7
    write(out, obj) { out.writeInt(obj as number); },
    read(inp)       { return inp.readInt(); },
};
```

Use `const` object literal (not class) — no instance state required.

| Serializer | typeId | Write | Read |
|---|---|---|---|
| `NullSerializer` | 0 | write nothing | return null |
| `BooleanSerializer` | -4 | `writeBoolean` | `readBoolean` |
| `ByteSerializer` | -3 | `writeByte` | `readByte` |
| `CharSerializer` | -5 | `writeChar` | `readChar` |
| `ShortSerializer` | -6 | `writeShort` | `readShort` |
| `IntegerSerializer` | -7 | `writeInt` | `readInt` |
| `LongSerializer` | -8 | `writeLong` (bigint\|number→bigint) | `readLong` |
| `FloatSerializer` | -9 | `writeFloat` | `readFloat` |
| `DoubleSerializer` | -10 | `writeDouble` | `readDouble` |
| `StringSerializer` | -11 | `writeString` | `readString` |
| `ByteArraySerializer` | -12 | `writeByteArray` | `readByteArray` |
| `BooleanArraySerializer` | -13 | `writeBooleanArray` | `readBooleanArray` |
| `CharArraySerializer` | -14 | `writeCharArray` | `readCharArray` |
| `ShortArraySerializer` | -15 | `writeShortArray` | `readShortArray` |
| `IntegerArraySerializer` | -16 | `writeIntArray` | `readIntArray` |
| `LongArraySerializer` | -17 | `writeLongArray` | `readLongArray` |
| `FloatArraySerializer` | -18 | `writeFloatArray` | `readFloatArray` |
| `DoubleArraySerializer` | -19 | `writeDoubleArray` | `readDoubleArray` |
| `StringArraySerializer` | -20 | `writeStringArray` | `readStringArray` |

**`CharSerializer` (typeId -5):** Hazelcast char is a Java 2-byte UTF-16 code unit.
JavaScript has no `char` primitive; represented as `number`. Required for read-path
compatibility when deserializing Java `Character` data. Infrastructure already exists:
`ByteArrayObjectDataOutput.writeChar()` and `ByteArrayObjectDataInput.readChar()`.

**`CharArraySerializer` (typeId -14):** Reads/writes arrays of UTF-16 code units as
`number[]`. Infrastructure: `writeCharArray()` / `readCharArray()`.

**`FloatArraySerializer` (typeId -18):** Required for read-path compatibility with Java
`float[]` data. Infrastructure: `writeFloatArray()` / `readFloatArray()`.

### `UuidSerializer` (typeId -21)

A UUID in Hazelcast wire format is `16 bytes: mostSigBits (int64) + leastSigBits (int64)`,
using the stream's configured byte order (default BIG_ENDIAN). Java's `UuidSerializer`
calls `out.writeLong()` without explicit byte order, inheriting the stream order.
TypeScript representation: string in standard `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` format.

Write:
```typescript
write(out, obj) {
    const hex = (obj as string).replace(/-/g, '');
    const most  = BigInt('0x' + hex.slice(0,  16));
    const least = BigInt('0x' + hex.slice(16, 32));
    out.writeLong(most);    // uses stream byte order (matches Java UuidSerializer)
    out.writeLong(least);   // uses stream byte order (matches Java UuidSerializer)
}
```

Read:
```typescript
read(inp) {
    const most  = inp.readLong();    // uses stream byte order (matches Java UuidSerializer)
    const least = inp.readLong();    // uses stream byte order (matches Java UuidSerializer)
    const hex = most.toString(16).padStart(16, '0') + least.toString(16).padStart(16, '0');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
```

### `JavaScriptJsonSerializer` (typeId -130)

The default fallback for arbitrary JS objects. Uses `JSON.stringify` / `JSON.parse`.

**Wire format (always, for both `toData` and `writeObject` paths):**
```
4 bytes  byteLength (int32, stream byte order)
N bytes  UTF-8 JSON payload
```

The length prefix is always written by `write()` and always expected by `read()`. This
makes the serializer self-framing — it works identically whether called from `toData()`
(where HeapData provides an outer boundary) or from `writeObject()` (where no outer
envelope exists).

```typescript
export const JavaScriptJsonSerializer: SerializerAdapter = {
    getTypeId: () => SerializationConstants.JAVASCRIPT_JSON_SERIALIZATION_TYPE,  // -130
    write(out, obj) {
        const json = JSON.stringify(obj);
        const utf8Bytes = Buffer.from(json, 'utf8');
        out.writeInt(utf8Bytes.length);
        out.writeBytes(utf8Bytes, 0, utf8Bytes.length);
    },
    read(inp) {
        const length = inp.readInt();
        const buf = Buffer.allocUnsafe(length);
        inp.readFully(buf);
        return JSON.parse(buf.toString('utf8'));
    },
};
```

**⚠ Breaking migration from `TestSerializationService`:** `TestSerializationService.toData()`
writes raw UTF-8 JSON bytes with NO length prefix. The new `JavaScriptJsonSerializer` writes
a 4-byte length prefix. This means:
- Data serialized by `TestSerializationService` (typeId=-130, no length prefix) **cannot** be
  deserialized by `SerializationServiceImpl` (expects length prefix).
- Data serialized by `SerializationServiceImpl` **cannot** be deserialized by
  `TestSerializationService` (does not expect length prefix).

**Migration strategy:** This is an in-memory-only break. Helios has no persistent storage.
When `HeliosInstanceImpl` switches from `TestSerializationService` to
`SerializationServiceImpl`, all map/ringbuffer data is empty (fresh process start). There is
no cross-version data migration path. The break is safe because:
1. No data survives process restart (all in-memory).
2. `TestSerializationService` remains available for unit tests that need the old behavior.
3. No external Hazelcast client is currently connected (no cross-wire compatibility needed yet).

### `DataSerializableSerializer` (typeId -2)

See "DataSerializableSerializer — IdentifiedDataSerializable Dispatch" section above.
Plain `DataSerializable` (non-identified) is **not supported** in this iteration — if the
header byte indicates non-identified, throw `HazelcastSerializationError: non-IdentifiedDataSerializable is not supported`.

---

## Error Handling

New error class:
```typescript
// src/internal/serialization/impl/HazelcastSerializationError.ts
export class HazelcastSerializationError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'HazelcastSerializationError';
        if (cause instanceof Error) this.cause = cause;
    }
}
```

Use this (not generic `Error`) for all serialization failures. Makes error handling at
call sites explicit and filterable.

---

## Wiring in `HeliosInstanceImpl`

```typescript
// Before (lines 111, 119):
this._nodeEngine = new NodeEngineImpl(new TestSerializationService());
this._nearCacheManager = new DefaultNearCacheManager(new TestSerializationService());

// After — single shared instance (critical: both must use the same registry):
const serializationConfig = new SerializationConfig();
// Register DataSerializerHooks here when subsystems are ported:
// serializationConfig.dataSerializerHooks.push(new PredicateDataSerializerHook());
const ss = new SerializationServiceImpl(serializationConfig);
this._nodeEngine = new NodeEngineImpl(ss);
this._nearCacheManager = new DefaultNearCacheManager(ss);
```

**Critical:** A single `SerializationServiceImpl` instance MUST be shared by both
`NodeEngineImpl` and `DefaultNearCacheManager`. Creating separate instances causes the
NearCacheManager's instance to have empty factory registries — any `toObject()` call
through the near-cache that encounters IDS-encoded data would throw "factory not found".
`SerializationServiceImpl` is immutable post-construction, so sharing is safe.

---

## Testing Strategy

New test files:

| Test file | What it covers |
|---|---|
| `test/internal/serialization/impl/SerializationServiceImplTest.test.ts` | `toData`/`toObject` round-trips for all primitive types, arrays, UUID, null, HeapData pass-through |
| `test/internal/serialization/impl/WriteReadObjectTest.test.ts` | `writeObject`/`readObject` round-trips for all serializable types embedded in a stream |
| `test/internal/serialization/impl/DataSerializableSerializerTest.test.ts` | IDS round-trip via mock factory |
| `test/internal/serialization/impl/HazelcastSerializationErrorTest.test.ts` | Error cases: unknown typeId, `writeObject(HeapData)`, non-IDS header |

**Existing tests must still pass.** All existing tests that use `TestSerializationService`
directly continue to work — `TestSerializationService` is not removed.

The existing test in `test/map/impl/record/RecordsTest.test.ts` uses a stub serialization
service — it should not need changes.

---

## Implementation Order (for the worker agent)

1. `HazelcastSerializationError.ts`
2. `SerializerAdapter.ts`
3. `DataSerializerHook.ts` (interface only)
4. `SerializationConfig.ts` (including `DataSerializableFactory`, `DataSerializerHook[]`)
5. `bufferpool/BufferPool.ts`
6. `serializers/NullSerializer.ts`
7. `serializers/` — all primitive serializers including CharSerializer (single file per, alphabetical)
8. `serializers/` — all array serializers including CharArraySerializer, FloatArraySerializer
9. `serializers/UuidSerializer.ts`
10. `serializers/JavaScriptJsonSerializer.ts`
11. `serializers/DataSerializableSerializer.ts`
12. `SerializationServiceImpl.ts` (with BufferPool, factory registration, serializerForTypeId error handling)
13. Update `HeliosInstanceImpl.ts` (single shared instance for NodeEngine + NearCacheManager)
14. Write tests
15. Run `bun test` — verify all existing tests pass, new tests pass

---

## Non-Goals — Architecturally Safe Omissions

These items are omitted because they are architecturally impossible to include in a
TypeScript port OR have no production code path that reaches them in the current helios
codebase. Each has a technical justification — not "out of scope" or "future work".

- **Portable serialization (typeId -1):** Requires a full PortableContext, ClassDefinition
  registry, and PortableSerializer. No class in helios `src/` implements the Portable
  interface or produces/consumes typeId -1 data. Adding it requires porting
  `PortableSerializer` + `PortableContextImpl` (~2000 lines). Omission is safe because
  the read path will throw a clear `HazelcastSerializationError` if typeId -1 is encountered.

- **Compact serialization (typeIds -55, -56):** Requires a `SchemaService`, schema
  distribution protocol, and `CompactStreamSerializer`. Major infrastructure (~5000 lines).
  No helios code path currently produces or consumes Compact data.

- **Java collection type IDs (-29 through -54):** These serialize Java-specific collection
  types (ArrayList, HashMap, etc.). JavaScript equivalents (Array, Map, Set) are serialized
  via the JSON fallback or as typed arrays. No helios code path writes these typeIds. The
  read path will throw a clear error if received from a Java node.

- **Java serialization fallback (typeIds -100, -101):** `Serializable`/`Externalizable` are
  Java-only concepts with no TypeScript equivalent. Architecturally impossible to implement
  without a JVM.

- **SimpleEntry / SimpleImmutableEntry (typeIds -22, -23):** Java `AbstractMap.SimpleEntry`
  pair types. No helios code path currently uses these. If needed, they would be trivial
  to add (read/write two `readObject`/`writeObject` calls). Omission is safe because no
  existing code produces these typeIds.

- **`ManagedContext.initialize()`:** Dependency injection hook for post-deserialization
  initialization. No helios subsystem currently requires it. Adding it later is a
  non-breaking change (add an optional `managedContext` field to config).

- **Partition strategy / partition hash calculation:** Partition hash is written as `0`.
  Correct partitioning requires implementing `PartitioningStrategy` and key extraction,
  which is a separate infrastructure concern. All current helios map operations work
  correctly with hash=0 (single-partition local mode).
