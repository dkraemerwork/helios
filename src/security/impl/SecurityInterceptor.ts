/**
 * Per-operation permission enforcement interceptor.
 *
 * Maps Hazelcast client protocol opcodes to the required ClusterPermission and
 * delegates the check to the session's SecurityContext.  Called in the dispatch
 * path before any handler executes.
 *
 * Opcode layout (Hazelcast 5.x binary client protocol):
 *   Bits [23:16] — service prefix  (0x01 = Map, 0x02 = MultiMap, 0x03 = Queue, …)
 *   Bits [15:8]  — operation id within service
 *   Bits [7:0]   — 0x00 for requests
 *
 * Port of com.hazelcast.client.impl.protocol.task.*MessageTask permission checks.
 */
import type { SecurityConfig } from '../../config/SecurityConfig.js';
import { ActionConstants } from '../permission/ActionConstants.js';
import { AtomicLongPermission } from '../permission/AtomicLongPermission.js';
import { CachePermission } from '../permission/CachePermission.js';
import { CardinalityEstimatorPermission } from '../permission/CardinalityEstimatorPermission.js';
import type { ClusterPermission } from '../permission/ClusterPermission.js';
import { CountDownLatchPermission } from '../permission/CountDownLatchPermission.js';
import { CPMapPermission } from '../permission/CPMapPermission.js';
import { ExecutorServicePermission } from '../permission/ExecutorServicePermission.js';
import { FlakeIdGeneratorPermission } from '../permission/FlakeIdGeneratorPermission.js';
import { ListPermission } from '../permission/ListPermission.js';
import { LockPermission } from '../permission/LockPermission.js';
import { MapPermission } from '../permission/MapPermission.js';
import { MultiMapPermission } from '../permission/MultiMapPermission.js';
import { QueuePermission } from '../permission/QueuePermission.js';
import { ReplicatedMapPermission } from '../permission/ReplicatedMapPermission.js';
import { ScheduledExecutorPermission } from '../permission/ScheduledExecutorPermission.js';
import { SemaphorePermission } from '../permission/SemaphorePermission.js';
import { SetPermission } from '../permission/SetPermission.js';
import { TopicPermission } from '../permission/TopicPermission.js';
import type { SecurityContext } from './SecurityContext.js';

// ── Opcode range constants (service prefix from bits [23:16]) ─────────────────
// These are the high 8 bits of the 24-bit opcode (bits 23-16).
const SVC_CLIENT        = 0x00; // 0x000xxx — client / auth ops (no permission needed)
const SVC_MAP           = 0x01; // 0x01xxxx — Map
const SVC_MULTIMAP      = 0x02; // 0x02xxxx — MultiMap
const SVC_QUEUE         = 0x03; // 0x03xxxx — Queue
const SVC_TOPIC         = 0x04; // 0x04xxxx — Topic
const SVC_LIST          = 0x05; // 0x05xxxx — List
const SVC_SET           = 0x06; // 0x06xxxx — Set
const SVC_LOCK          = 0x07; // 0x07xxxx — Lock (FencedLock via Raft)
const SVC_MULTIMAP_EX   = 0x02; // same prefix as MultiMap (aliased)
const SVC_TX            = 0x0e; // 0x0exxxx — Transaction (no data-structure perm)
const SVC_TX_MAP        = 0x0f; // 0x0fxxxx — TransactionalMap
const SVC_TX_MULTIMAP   = 0x10; // 0x10xxxx — TransactionalMultiMap
const SVC_TX_LIST       = 0x11; // 0x11xxxx — TransactionalList
const SVC_TX_SET        = 0x12; // 0x12xxxx — TransactionalSet
const SVC_TX_QUEUE      = 0x13; // 0x13xxxx — TransactionalQueue
const SVC_REPLICATED    = 0x0d; // 0x0dxxxx — ReplicatedMap
const SVC_CACHE         = 0x15; // 0x15xxxx — Cache (JCache / ICache)
const SVC_RINGBUFFER    = 0x19; // 0x19xxxx — Ringbuffer
const SVC_FLAKEID       = 0x1e; // 0x1exxxx — FlakeIdGenerator
const SVC_CARDINALITY   = 0x20; // 0x20xxxx — CardinalityEstimator
const SVC_SCHEDULED_EX  = 0x1a; // 0x1axxxx — ScheduledExecutor
const SVC_EXECUTOR      = 0x09; // 0x09xxxx — ExecutorService
const SVC_CP_GROUP      = 0x1c; // 0x1cxxxx — CP group management
const SVC_ATOMIC_LONG   = 0x0a; // 0x0axxxx — AtomicLong (and AtomicRef overlap)
const SVC_SEMAPHORE     = 0x0c; // 0x0cxxxx — Semaphore (Raft-based)
const SVC_COUNTDOWN     = 0x0b; // 0x0bxxxx — CountDownLatch (Raft-based)
const SVC_CP_MAP        = 0x23; // 0x23xxxx — CPMap
const SVC_PNCOUNTER     = 0x1d; // 0x1dxxxx — PNCounter (CRDT, no specific perm)
const SVC_SQL           = 0x21; // 0x21xxxx — SQL (no specific permission currently)
const SVC_VECTOR        = 0x25; // 0x25xxxx — VectorCollection (not yet enforced)

// ── Map opcode → action(s) classification ────────────────────────────────────
//
// Bit [15:8] (second byte) identifies the specific operation within a service.
// We classify each by the required action string.

/** Map operation ids (second byte of 24-bit opcode) and their required actions. */
const MAP_READ_OPS = new Set([
    0x02, // Map.Get
    0x06, // Map.ContainsKey
    0x07, // Map.ContainsValue
    0x0f, // Map.Set (includes put-then-read side)
    0x19, // Map.AddEntryListener
    0x1d, // Map.GetEntryView
    0x22, // Map.KeySet
    0x23, // Map.GetAll
    0x24, // Map.Values
    0x25, // Map.EntrySet
    0x26, // Map.KeySetWithPredicate
    0x27, // Map.ValuesWithPredicate
    0x28, // Map.EntriesWithPredicate
    0x2a, // Map.Size
    0x2b, // Map.IsEmpty
    0x34, // Map.KeySetWithPagingPredicate
    0x35, // Map.ValuesWithPagingPredicate
    0x36, // Map.EntriesWithPagingPredicate
    0x37, // Map.QueryWithPredicate (if exists)
    0x39, // Map.Aggregate
    0x3a, // Map.AggregateWithPredicate
    0x3b, // Map.Project
    0x3c, // Map.ProjectWithPredicate
]);

const MAP_PUT_OPS = new Set([
    0x01, // Map.Put
    0x04, // Map.Replace
    0x05, // Map.ReplaceIfSame
    0x0c, // Map.TryPut
    0x0d, // Map.PutTransient
    0x0e, // Map.PutIfAbsent
    0x20, // Map.LoadAll
    0x21, // Map.LoadGivenKeys
    0x2c, // Map.PutAll
    0x44, // Map.PutWithMaxIdle
    0x45, // Map.PutTransientWithMaxIdle
    0x46, // Map.PutIfAbsentWithMaxIdle
    0x47, // Map.SetWithMaxIdle
]);

const MAP_REMOVE_OPS = new Set([
    0x03, // Map.Remove
    0x08, // Map.RemoveIfSame
    0x09, // Map.Delete
    0x0b, // Map.TryRemove
    0x3e, // Map.RemoveAll
]);

const MAP_LOCK_OPS = new Set([
    0x12, // Map.Lock
    0x13, // Map.Unlock
    0x14, // Map.TryLock
    0x15, // Map.IsLocked
    0x33, // Map.ForceUnlock
]);

// ── SecurityInterceptor ───────────────────────────────────────────────────────

export class SecurityInterceptor {
    private readonly _config: SecurityConfig;

    constructor(config: SecurityConfig) {
        this._config = config;
    }

    /**
     * Check whether the given SecurityContext grants the required permission for
     * the message type and data-structure name.
     *
     * @throws AccessControlException (via context.checkPermission) if denied.
     */
    checkPermission(context: SecurityContext, permission: ClusterPermission): void {
        context.checkPermission(permission);
    }

    /**
     * Derive the required permission for a given client protocol opcode and
     * optional data structure name.
     *
     * Returns null for opcodes that do not require a permission check (e.g.
     * authentication, heartbeat, client metadata).
     *
     * @param messageType  The 24-bit client protocol opcode.
     * @param objectName   Data structure name (may be '*' when unknown).
     */
    getRequiredPermission(messageType: number, objectName: string = '*'): ClusterPermission | null {
        const svc = (messageType >>> 16) & 0xff;
        const op  = (messageType >>> 8)  & 0xff;

        switch (svc) {

            // ── Client / Auth / Heartbeat — no permission ─────────────────────
            case SVC_CLIENT:
                return null;

            // ── Map ───────────────────────────────────────────────────────────
            case SVC_MAP:
                return this._mapPermission(op, objectName);

            // ── MultiMap ──────────────────────────────────────────────────────
            case SVC_MULTIMAP:
                return this._multiMapPermission(op, objectName);

            // ── Queue ─────────────────────────────────────────────────────────
            case SVC_QUEUE:
                return this._queuePermission(op, objectName);

            // ── Topic ─────────────────────────────────────────────────────────
            case SVC_TOPIC:
                return this._topicPermission(op, objectName);

            // ── List ──────────────────────────────────────────────────────────
            case SVC_LIST:
                return this._listPermission(op, objectName);

            // ── Set ───────────────────────────────────────────────────────────
            case SVC_SET:
                return this._setPermission(op, objectName);

            // ── Lock (FencedLock, CP-based) ───────────────────────────────────
            case SVC_LOCK:
                return new LockPermission(objectName, ActionConstants.ACTION_LOCK);

            // ── Transaction control — no data-structure perm ─────────────────
            case SVC_TX:
                return null;

            // ── TransactionalMap ──────────────────────────────────────────────
            case SVC_TX_MAP:
                return new MapPermission(objectName, ActionConstants.ACTION_PUT, ActionConstants.ACTION_READ, ActionConstants.ACTION_REMOVE);

            // ── TransactionalMultiMap ─────────────────────────────────────────
            case SVC_TX_MULTIMAP:
                return new MultiMapPermission(objectName, ActionConstants.ACTION_PUT, ActionConstants.ACTION_READ, ActionConstants.ACTION_REMOVE);

            // ── TransactionalList ─────────────────────────────────────────────
            case SVC_TX_LIST:
                return new ListPermission(objectName, ActionConstants.ACTION_ADD, ActionConstants.ACTION_READ, ActionConstants.ACTION_REMOVE);

            // ── TransactionalSet ──────────────────────────────────────────────
            case SVC_TX_SET:
                return new SetPermission(objectName, ActionConstants.ACTION_ADD, ActionConstants.ACTION_READ, ActionConstants.ACTION_REMOVE);

            // ── TransactionalQueue ────────────────────────────────────────────
            case SVC_TX_QUEUE:
                return new QueuePermission(objectName, ActionConstants.ACTION_ADD, ActionConstants.ACTION_READ, ActionConstants.ACTION_REMOVE);

            // ── ReplicatedMap ─────────────────────────────────────────────────
            case SVC_REPLICATED:
                return this._replicatedMapPermission(op, objectName);

            // ── Cache (JCache / ICache) ───────────────────────────────────────
            case SVC_CACHE:
                return this._cachePermission(op, objectName);

            // ── Ringbuffer ────────────────────────────────────────────────────
            case SVC_RINGBUFFER:
                // Ringbuffer reuses QueuePermission
                return new QueuePermission(objectName, ActionConstants.ACTION_READ, ActionConstants.ACTION_ADD);

            // ── Executor ──────────────────────────────────────────────────────
            case SVC_EXECUTOR:
                return new ExecutorServicePermission(objectName, ActionConstants.ACTION_MODIFY);

            // ── AtomicLong / AtomicReference (shared prefix 0x0a) ────────────
            case SVC_ATOMIC_LONG:
                return this._atomicPermission(op, objectName);

            // ── CountDownLatch ────────────────────────────────────────────────
            case SVC_COUNTDOWN:
                return new CountDownLatchPermission(objectName, ActionConstants.ACTION_MODIFY, ActionConstants.ACTION_READ);

            // ── Semaphore ─────────────────────────────────────────────────────
            case SVC_SEMAPHORE:
                return new SemaphorePermission(objectName, ActionConstants.ACTION_ACQUIRE, ActionConstants.ACTION_RELEASE);

            // ── ScheduledExecutor ─────────────────────────────────────────────
            case SVC_SCHEDULED_EX:
                return new ScheduledExecutorPermission(objectName, ActionConstants.ACTION_MODIFY, ActionConstants.ACTION_READ);

            // ── FlakeIdGenerator ──────────────────────────────────────────────
            case SVC_FLAKEID:
                return new FlakeIdGeneratorPermission(objectName, ActionConstants.ACTION_MODIFY);

            // ── CardinalityEstimator ──────────────────────────────────────────
            case SVC_CARDINALITY:
                return new CardinalityEstimatorPermission(objectName, ActionConstants.ACTION_READ, ActionConstants.ACTION_MODIFY);

            // ── CP group management — admin level, no per-resource perm ───────
            case SVC_CP_GROUP:
                return null;

            // ── CPMap ─────────────────────────────────────────────────────────
            case SVC_CP_MAP:
                return this._cpMapPermission(op, objectName);

            // ── PNCounter — treated as read+modify ────────────────────────────
            case SVC_PNCOUNTER:
                return null; // PNCounter has no specific InstancePermission yet

            // ── SQL — no per-table permission at this level ───────────────────
            case SVC_SQL:
                return null;

            // ── VectorCollection — not yet enforced ───────────────────────────
            case SVC_VECTOR:
                return null;

            default:
                // Unknown service — do not block, return null
                return null;
        }
    }

    // ── Per-service helpers ───────────────────────────────────────────────────

    private _mapPermission(op: number, name: string): ClusterPermission {
        if (op === 0x29) {
            // Map.AddIndex
            return new MapPermission(name, ActionConstants.ACTION_INDEX);
        }
        if (op === 0x2d || op === 0x30 || op === 0x31 || op === 0x32 || op === 0x2e) {
            // Map.ExecuteOnKey, ExecuteOnAllKeys, ExecuteWithPredicate, ExecuteOnKeys, ExecuteOnPartition
            return new MapPermission(name, ActionConstants.ACTION_PUT, ActionConstants.ACTION_READ, ActionConstants.ACTION_REMOVE);
        }
        if (op === 0x43) {
            // Map.SetTtl
            return new MapPermission(name, ActionConstants.ACTION_PUT);
        }
        if (op === 0x1e || op === 0x1f) {
            // Map.Evict, EvictAll
            return new MapPermission(name, ActionConstants.ACTION_REMOVE);
        }
        if (op === 0x0a) {
            // Map.Flush
            return new MapPermission(name, ActionConstants.ACTION_READ);
        }
        if (op === 0x2d) {
            // Map.Clear
            return new MapPermission(name, ActionConstants.ACTION_REMOVE);
        }
        if (MAP_READ_OPS.has(op)) {
            return new MapPermission(name, ActionConstants.ACTION_READ);
        }
        if (MAP_PUT_OPS.has(op)) {
            return new MapPermission(name, ActionConstants.ACTION_PUT);
        }
        if (MAP_REMOVE_OPS.has(op)) {
            return new MapPermission(name, ActionConstants.ACTION_REMOVE);
        }
        if (MAP_LOCK_OPS.has(op)) {
            return new MapPermission(name, ActionConstants.ACTION_LOCK);
        }
        // Map.AddEntryListener variants
        if (op >= 0x16 && op <= 0x1c) {
            return new MapPermission(name, ActionConstants.ACTION_LISTEN);
        }
        // Map.Clear (0x2d)
        if (op === 0x2d) {
            return new MapPermission(name, ActionConstants.ACTION_REMOVE);
        }
        // Default: require read + put for any unknown map op
        return new MapPermission(name, ActionConstants.ACTION_READ);
    }

    private _multiMapPermission(op: number, name: string): ClusterPermission {
        switch (op) {
            case 0x01: // Put
                return new MultiMapPermission(name, ActionConstants.ACTION_PUT);
            case 0x02: // Get
            case 0x04: // ContainsKey
            case 0x05: // ContainsValue
            case 0x06: // ContainsEntry
            case 0x07: // Size
            case 0x08: // Clear (read side)
            case 0x09: // ValueCount
            case 0x0b: // KeySet
            case 0x0c: // Values
            case 0x0d: // EntrySet
                return new MultiMapPermission(name, ActionConstants.ACTION_READ);
            case 0x03: // Remove
                return new MultiMapPermission(name, ActionConstants.ACTION_REMOVE);
            case 0x0e: // AddEntryListener
            case 0x0f: // AddEntryListenerToKey
                return new MultiMapPermission(name, ActionConstants.ACTION_LISTEN);
            case 0x10: // Lock
            case 0x11: // TryLock
            case 0x12: // IsLocked
            case 0x13: // Unlock
            case 0x14: // ForceUnlock
                return new MultiMapPermission(name, ActionConstants.ACTION_LOCK);
            default:
                return new MultiMapPermission(name, ActionConstants.ACTION_READ);
        }
    }

    private _queuePermission(op: number, name: string): ClusterPermission {
        switch (op) {
            case 0x01: // Offer
            case 0x02: // Put
                return new QueuePermission(name, ActionConstants.ACTION_ADD);
            case 0x03: // Poll
            case 0x04: // Take
            case 0x05: // Remove
            case 0x08: // Clear
            case 0x0a: // Drain
                return new QueuePermission(name, ActionConstants.ACTION_REMOVE);
            case 0x06: // Peek
            case 0x07: // Element
            case 0x09: // Contains
            case 0x0b: // ContainsAll
            case 0x0c: // CompareAndRemoveAll
            case 0x0d: // CompareAndRetainAll
            case 0x0e: // ToArray
            case 0x0f: // Size
            case 0x10: // IsEmpty
            case 0x12: // RemainingCapacity
                return new QueuePermission(name, ActionConstants.ACTION_READ);
            case 0x11: // AddListener
                return new QueuePermission(name, ActionConstants.ACTION_LISTEN);
            default:
                return new QueuePermission(name, ActionConstants.ACTION_READ);
        }
    }

    private _topicPermission(op: number, name: string): ClusterPermission {
        switch (op) {
            case 0x01: // Publish
            case 0x02: // PublishAll
                return new TopicPermission(name, ActionConstants.ACTION_PUBLISH);
            case 0x03: // AddMessageListener
            case 0x04: // RemoveMessageListener
                return new TopicPermission(name, ActionConstants.ACTION_LISTEN);
            default:
                return new TopicPermission(name, ActionConstants.ACTION_LISTEN);
        }
    }

    private _listPermission(op: number, name: string): ClusterPermission {
        switch (op) {
            case 0x01: // Size
            case 0x02: // Contains
            case 0x03: // ContainsAll
            case 0x06: // Get
            case 0x07: // IndexOf
            case 0x08: // LastIndexOf
            case 0x09: // SubList
            case 0x0a: // Iterator
            case 0x0b: // ListIterator
            case 0x0e: // ToArray
            case 0x0f: // IsEmpty
                return new ListPermission(name, ActionConstants.ACTION_READ);
            case 0x04: // Add
            case 0x05: // AddAll
            case 0x10: // Set
                return new ListPermission(name, ActionConstants.ACTION_ADD);
            case 0x11: // Remove
            case 0x12: // RemoveAll
            case 0x13: // RetainAll
            case 0x14: // Clear
                return new ListPermission(name, ActionConstants.ACTION_REMOVE);
            case 0x0b: // AddListener
                return new ListPermission(name, ActionConstants.ACTION_LISTEN);
            default:
                return new ListPermission(name, ActionConstants.ACTION_READ);
        }
    }

    private _setPermission(op: number, name: string): ClusterPermission {
        switch (op) {
            case 0x01: // Size
            case 0x02: // Contains
            case 0x03: // ContainsAll
            case 0x07: // Iterator
            case 0x08: // ToArray
            case 0x09: // IsEmpty
                return new SetPermission(name, ActionConstants.ACTION_READ);
            case 0x04: // Add
            case 0x05: // AddAll
                return new SetPermission(name, ActionConstants.ACTION_ADD);
            case 0x06: // Remove
            case 0x0a: // RemoveAll
            case 0x0b: // RetainAll
            case 0x0c: // Clear
                return new SetPermission(name, ActionConstants.ACTION_REMOVE);
            case 0x0b: // AddListener
                return new SetPermission(name, ActionConstants.ACTION_LISTEN);
            default:
                return new SetPermission(name, ActionConstants.ACTION_READ);
        }
    }

    private _replicatedMapPermission(op: number, name: string): ClusterPermission {
        switch (op) {
            case 0x01: // Put
            case 0x04: // PutAll
                return new ReplicatedMapPermission(name, ActionConstants.ACTION_PUT);
            case 0x02: // Get
            case 0x05: // Size
            case 0x06: // IsEmpty
            case 0x07: // ContainsKey
            case 0x08: // ContainsValue
            case 0x09: // KeySet
            case 0x0a: // Values
            case 0x0b: // EntrySet
                return new ReplicatedMapPermission(name, ActionConstants.ACTION_READ);
            case 0x03: // Remove
            case 0x0c: // Clear
                return new ReplicatedMapPermission(name, ActionConstants.ACTION_REMOVE);
            case 0x0d: // AddEntryListener
            case 0x0e: // AddEntryListenerToKey
            case 0x0f: // AddEntryListenerWithPredicate
            case 0x10: // AddEntryListenerToKeyWithPredicate
            case 0x11: // RemoveEntryListener
                return new ReplicatedMapPermission(name, ActionConstants.ACTION_LISTEN);
            default:
                return new ReplicatedMapPermission(name, ActionConstants.ACTION_READ);
        }
    }

    private _cachePermission(op: number, name: string): ClusterPermission {
        switch (op) {
            case 0x01: // Clear
            case 0x02: // ClearAll
                return new CachePermission(name, ActionConstants.ACTION_REMOVE);
            case 0x03: // ContainsKey
            case 0x04: // CreateConfig
            case 0x05: // Destroy
            case 0x06: // EntrySet
            case 0x07: // GetAll
            case 0x08: // GetAndRemove
            case 0x09: // GetAndReplace
            case 0x0a: // Get
            case 0x0b: // Iterate
            case 0x0d: // Size
            case 0x0e: // KeySet
                return new CachePermission(name, ActionConstants.ACTION_READ);
            case 0x0c: // Put
            case 0x0f: // PutAll
            case 0x10: // PutIfAbsent
            case 0x11: // Remove
            case 0x12: // RemoveAll
            case 0x13: // Replace
            case 0x14: // ReplaceWithOldValue
                return new CachePermission(name, ActionConstants.ACTION_PUT);
            case 0x15: // AddEntryListener
            case 0x16: // AddInvalidationListener
            case 0x17: // AddNearCacheInvalidationListener
            case 0x18: // RemoveEntryListener
                return new CachePermission(name, ActionConstants.ACTION_LISTEN);
            default:
                return new CachePermission(name, ActionConstants.ACTION_READ);
        }
    }

    private _atomicPermission(op: number, name: string): ClusterPermission {
        // Ops 0x01-0x09 are AtomicLong; ops with begin-frame marker are AtomicReference.
        // The SecurityInterceptor doesn't distinguish — both require modify+read.
        switch (op) {
            case 0x01: // AddAndGet / Apply
            case 0x02: // CompareAndSet / Alter
            case 0x03: // DecrementAndGet / AlterAndGet
            case 0x04: // Get / GetAndAlter
            case 0x05: // GetAndAdd / GetAndSet
            case 0x06: // GetAndSet / IsNull
            case 0x07: // Set / Set
            case 0x08: // IncrementAndGet
            case 0x09: // GetAndIncrement
                return new AtomicLongPermission(name, ActionConstants.ACTION_MODIFY, ActionConstants.ACTION_READ);
            default:
                return new AtomicLongPermission(name, ActionConstants.ACTION_READ);
        }
    }

    private _cpMapPermission(op: number, name: string): ClusterPermission {
        switch (op) {
            case 0x01: // Get
            case 0x06: // Size
                return new CPMapPermission(name, ActionConstants.ACTION_READ);
            case 0x02: // Put
            case 0x03: // Set
            case 0x04: // PutIfAbsent
            case 0x05: // Remove
            case 0x07: // Delete
            case 0x08: // Compare
                return new CPMapPermission(name, ActionConstants.ACTION_PUT, ActionConstants.ACTION_REMOVE);
            default:
                return new CPMapPermission(name, ActionConstants.ACTION_READ);
        }
    }
}
