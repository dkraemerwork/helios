# Helios Feature Inventory — hazelcast-client@5.6.x Compatibility

**Target:** `hazelcast-client@5.6.0` / Hazelcast OSS `5.5.0`  
**Protocol:** Client Protocol 2.8  
**Audit date:** 2026-03-08  

Gap status legend:
- **DONE** — Feature is fully implemented and tested
- **PARTIAL** — Core functionality exists but edge cases / sub-features are missing
- **MISSING** — Not implemented at all

---

## 1. Official remote-client boundary

| Method / Feature | Description | Helios owner | Status |
|---|---|---|---|
| `Client.newHazelcastClient(config)` | Create and connect with the official package | Helios server client protocol | DONE |
| `client.getMap(name)` | Get IMap proxy | Helios server runtime + client protocol | DONE |
| `client.getQueue(name)` | Get IQueue proxy | Helios server runtime + client protocol | DONE |
| `client.getList(name)` | Get IList proxy | Helios server runtime + client protocol | DONE |
| `client.getSet(name)` | Get ISet proxy | Helios server runtime + client protocol | DONE |
| `client.getMultiMap(name)` | Get MultiMap proxy | Helios server runtime + client protocol | DONE |
| `client.getReliableTopic(name)` | Get reliable topic proxy | Helios server runtime + client protocol | DONE |
| `client.getReplicatedMap(name)` | Get replicated map proxy | Helios server runtime + client protocol | DONE |
| `client.getRingbuffer(name)` | Get ringbuffer proxy | Helios server runtime + client protocol | DONE |
| `client.getCPSubsystem()` | CP atomics and single-node latch/semaphore proof | Helios server runtime + client protocol | DONE |
| `client.getPNCounter(name)` | Get PN counter proxy | Helios server runtime + client protocol | DONE |
| `client.getFlakeIdGenerator(name)` | Get flake ID generator proxy | Helios server runtime + client protocol | DONE |
| `client.getSql()` | SQL access | Helios server runtime + client protocol | DONE |
| `client.getTopic(name)` | Standard topic proxy | No public API in pinned package | MISSING |
| `client.getCacheManager()` | Cache access | No public API in pinned package | MISSING |
| `client.getExecutorService(name)` | Executor access | No public API in pinned package | MISSING |
| `client.getScheduledExecutorService(name)` | Scheduled executor access | No public API in pinned package | MISSING |

---

## 2. IMap

Server-side implementation: `src/map/impl/MapProxy.ts`  
Official client proof: `test/interop/suites/map.test.ts`  
Codec set: `src/client/impl/protocol/codec/Map*.ts`

| Method | Description | Server Status | Client Codec |
|---|---|---|---|
| `put(key, value)` | Set key→value, return old | DONE | DONE (0x010100) |
| `put(key, value, ttl)` | Put with TTL | PARTIAL — TTL parsed but not enforced per-entry | DONE (0x010100) |
| `putAll(entries)` | Bulk put | DONE | PARTIAL |
| `putIfAbsent(key, value)` | Conditional insert | DONE | MISSING |
| `putAsync(key, value)` | Async put | DONE | MISSING |
| `set(key, value)` | Set without return | DONE | DONE (0x010600) |
| `set(key, value, ttl)` | Set with TTL | PARTIAL | DONE (0x010600) |
| `setAsync(key, value)` | Async set | DONE | MISSING |
| `get(key)` | Get value | DONE | DONE (0x010200) |
| `getAll(keys)` | Bulk get | DONE | PARTIAL |
| `getAsync(key)` | Async get | DONE | MISSING |
| `remove(key)` | Remove, return old | DONE | DONE (0x010700) |
| `remove(key, value)` | Conditional remove | MISSING | MISSING |
| `removeAll(predicate)` | Remove by predicate | MISSING | MISSING |
| `removeAsync(key)` | Async remove | DONE | MISSING |
| `delete(key)` | Remove without return | DONE | DONE (0x010800) |
| `evict(key)` | Evict from local cache | MISSING | MISSING |
| `evictAll()` | Evict all local entries | MISSING | MISSING |
| `containsKey(key)` | Key presence check | DONE | DONE (0x010900) |
| `containsValue(value)` | Value scan | DONE | MISSING |
| `size()` | Entry count | DONE | DONE (0x010A00) |
| `isEmpty()` | Empty check | DONE | MISSING |
| `clear()` | Remove all entries | DONE | DONE (0x010B00) |
| `keySet()` | All keys | DONE | MISSING |
| `keySet(predicate)` | Predicate key scan | DONE | MISSING |
| `values()` | All values | DONE | MISSING |
| `values(predicate)` | Predicate value scan | DONE | MISSING |
| `entrySet()` | All entries | DONE | MISSING |
| `entrySet(predicate)` | Predicate entry scan | DONE | MISSING |
| `replace(key, value)` | Replace if present | DONE | MISSING |
| `replaceIfSame(key, oldV, newV)` | CAS replace | DONE | MISSING |
| `addIndex(indexConfig)` | Add query index | DONE | MISSING |
| `aggregate(aggregator)` | Execute aggregator | DONE | MISSING |
| `aggregate(aggregator, predicate)` | Filtered aggregator | DONE | MISSING |
| `project(projection)` | Project entries | MISSING | MISSING |
| `project(projection, predicate)` | Filtered projection | MISSING | MISSING |
| `executeOnKey(key, entryProcessor)` | Entry processor | MISSING | MISSING |
| `executeOnKeys(keys, entryProcessor)` | Bulk entry processor | MISSING | MISSING |
| `executeOnEntries(entryProcessor)` | All-entry processor | MISSING | MISSING |
| `executeOnEntries(entryProcessor, predicate)` | Filtered entry processor | MISSING | MISSING |
| `submitToKey(key, entryProcessor)` | Async entry processor | MISSING | MISSING |
| `lock(key)` | Acquire lock | DONE (in-process only) | MISSING |
| `lock(key, leaseTime)` | Timed lock | MISSING | MISSING |
| `tryLock(key)` | Non-blocking lock | DONE (in-process only) | MISSING |
| `tryLock(key, timeout)` | Timed try-lock | MISSING | MISSING |
| `unlock(key)` | Release lock | DONE | MISSING |
| `isLocked(key)` | Lock status | DONE | MISSING |
| `forceUnlock(key)` | Force unlock | MISSING | MISSING |
| `addEntryListener(listener)` | Map event listener | DONE | DONE (0x011900) |
| `addEntryListener(listener, key)` | Key-filtered listener | MISSING | MISSING |
| `addEntryListener(listener, predicate)` | Predicate listener | MISSING | MISSING |
| `removeEntryListener(id)` | Deregister listener | DONE | MISSING |
| `addPartitionLostListener(listener)` | Partition-lost events | DONE | MISSING |
| `removePartitionLostListener(id)` | Deregister pl listener | DONE | MISSING |
| `putWithMaxIdle(key, value, ttl, maxIdle)` | TTL + maxIdle | MISSING | MISSING |
| `setWithMaxIdle(key, value, ttl, maxIdle)` | Set with maxIdle | MISSING | MISSING |
| `tryPut(key, value, timeout)` | Non-blocking put | MISSING | MISSING |
| `tryRemove(key, timeout)` | Non-blocking remove | MISSING | MISSING |
| `flush()` | Flush write-behind | MISSING | MISSING |
| `loadAll(replaceExisting)` | Reload from MapLoader | MISSING | MISSING |
| `getEntryView(key)` | Full entry metadata | MISSING | MISSING |
| `getLocalMapStats()` | Local stats | PARTIAL (provider exists) | MISSING |
| Near Cache (map-side) | Local read cache | PARTIAL | PARTIAL |
| MapStore (write-through) | Synchronous external store | DONE | N/A |
| MapStore (write-behind) | Async external store | DONE | N/A |
| MapLoader (load-on-miss) | Load from external store | DONE | N/A |

---

## 3. IQueue

Server-side: `src/collection/impl/QueueImpl.ts` / `src/collection/impl/queue/QueueProxyImpl.ts`  
Client codec: `src/client/impl/protocol/codec/Queue*.ts`

| Method | Description | Server Status | Client Codec |
|---|---|---|---|
| `offer(element)` | Non-blocking enqueue | DONE | DONE (0x030100) |
| `offer(element, timeout)` | Timed enqueue | DONE | DONE (0x030100) |
| `put(element)` | Blocking enqueue | DONE | MISSING |
| `add(element)` | Unchecked enqueue | DONE | MISSING |
| `poll()` | Non-blocking dequeue | DONE | DONE (0x030200) |
| `poll(timeout)` | Timed dequeue | DONE | DONE (0x030200) |
| `take()` | Blocking dequeue | DONE | MISSING |
| `peek()` | Head without removal | DONE | DONE (0x030300) |
| `element()` | Head, throws if empty | DONE | MISSING |
| `remove(element)` | Remove specific element | DONE | MISSING |
| `contains(element)` | Element membership | DONE | MISSING |
| `containsAll(c)` | Bulk contains | DONE | MISSING |
| `size()` | Queue size | DONE | DONE (0x030600) |
| `isEmpty()` | Empty check | DONE | MISSING |
| `clear()` | Remove all | DONE | DONE (0x030400) |
| `toArray()` | Snapshot | DONE | MISSING |
| `drainTo(c)` | Drain all to collection | DONE | MISSING |
| `drainTo(c, max)` | Drain with limit | DONE | MISSING |
| `addAll(c)` | Bulk add | DONE | MISSING |
| `removeAll(c)` | Bulk remove | DONE | MISSING |
| `retainAll(c)` | Retain intersection | DONE | MISSING |
| `remainingCapacity()` | Remaining capacity | DONE | MISSING |
| `addItemListener(listener)` | Add item listener | DONE | MISSING |
| `removeItemListener(id)` | Remove item listener | DONE | MISSING |
| `getLocalQueueStats()` | Queue stats | DONE | MISSING |
| `iterator()` | Element iterator | DONE | N/A |

---

## 4. ITopic

Server-side: `src/topic/impl/TopicProxyImpl.ts`  
Client codec: `src/client/impl/protocol/codec/Topic*.ts`

| Method | Description | Server Status | Client Codec |
|---|---|---|---|
| `publish(message)` | Publish message | DONE | DONE (0x040100) |
| `publishAll(messages)` | Bulk publish | MISSING | MISSING |
| `addMessageListener(listener)` | Subscribe | DONE | DONE (0x040200) |
| `removeMessageListener(id)` | Unsubscribe | DONE | DONE (0x040300) |
| `getLocalTopicStats()` | Topic statistics | PARTIAL | MISSING |

---

## 5. ReliableTopic (Ringbuffer-backed)

Server-side: `src/topic/impl/reliable/ReliableTopicProxyImpl.ts`  
Official client proof: `test/interop/suites/topic.test.ts`

| Method | Description | Status |
|---|---|---|
| `publish(message)` | Publish via ringbuffer | DONE |
| `publishAll(messages)` | Batch publish | MISSING |
| `addMessageListener(listener)` | Subscribe with sequence tracking | DONE |
| `removeMessageListener(id)` | Unsubscribe | DONE |
| `getLocalTopicStats()` | Stats | PARTIAL |
| Reliable delivery guarantee | Exactly-once via sequence | PARTIAL |
| Loss tolerance mode | Configure loss policy | PARTIAL |

---

## 6. Ringbuffer

Server-side: `src/ringbuffer/impl/Ringbuffer.ts`, `src/ringbuffer/impl/RingbufferService.ts`

| Method | Description | Status |
|---|---|---|
| `add(item)` | Add to tail | DONE |
| `addAsync(item, policy)` | Async add with overflow policy | PARTIAL |
| `addAll(items, policy)` | Batch add | DONE |
| `addAllAsync(items, policy)` | Async batch add | PARTIAL |
| `readOne(sequence)` | Read single item | DONE |
| `readManyAsync(seq, min, max, filter)` | Async batch read | DONE |
| `headSequence()` | Oldest sequence | DONE |
| `tailSequence()` | Newest sequence | DONE |
| `remainingCapacity()` | Remaining slots | DONE |
| `capacity()` | Buffer capacity | DONE |
| `size()` | Number of stored items | DONE |
| Client codec (RingbufferAdd) | 0x190100 | MISSING |
| Client codec (RingbufferReadMany) | 0x190300 | MISSING |

---

## 7. IList

Server-side: `src/collection/impl/ListImpl.ts`

| Method | Description | Status |
|---|---|---|
| `add(element)` | Append | DONE |
| `add(index, element)` | Insert at position | DONE |
| `addAll(c)` | Bulk append | DONE |
| `get(index)` | Get by position | DONE |
| `set(index, element)` | Replace at position | DONE |
| `remove(index)` | Remove by position | DONE |
| `remove(element)` | Remove by value | DONE |
| `indexOf(element)` | First occurrence | DONE |
| `lastIndexOf(element)` | Last occurrence | DONE |
| `contains(element)` | Membership test | DONE |
| `containsAll(c)` | Bulk contains | DONE |
| `size()` | List size | DONE |
| `isEmpty()` | Empty check | DONE |
| `clear()` | Remove all | DONE |
| `subList(from, to)` | Range view | DONE |
| `toArray()` | Snapshot | DONE |
| `sort(comparator)` | Sort in place | DONE |
| `addItemListener(listener)` | Item events | DONE |
| `removeItemListener(id)` | Deregister | DONE |
| Client codecs | 0x050x00 series | MISSING |

---

## 8. ISet

Server-side: `src/collection/impl/SetImpl.ts`

| Method | Description | Status |
|---|---|---|
| `add(element)` | Add element | DONE |
| `remove(element)` | Remove element | DONE |
| `contains(element)` | Membership | DONE |
| `containsAll(c)` | Bulk contains | DONE |
| `addAll(c)` | Bulk add | DONE |
| `removeAll(c)` | Bulk remove | DONE |
| `retainAll(c)` | Retain intersection | DONE |
| `size()` | Set size | DONE |
| `isEmpty()` | Empty check | DONE |
| `clear()` | Remove all | DONE |
| `toArray()` | Snapshot | DONE |
| `iterator()` | Element iterator | DONE |
| `addItemListener(listener)` | Item events | DONE |
| `removeItemListener(id)` | Deregister | DONE |
| Client codecs | 0x060x00 series | MISSING |

---

## 9. MultiMap

Server-side: `src/multimap/impl/MultiMapImpl.ts`

| Method | Description | Status |
|---|---|---|
| `put(key, value)` | Add key→value pair | DONE |
| `get(key)` | Get all values for key | DONE |
| `remove(key, value)` | Remove specific pair | DONE |
| `removeAll(key)` | Remove all for key | DONE |
| `delete(key)` | Remove all for key (void) | DONE |
| `keySet()` | All keys | DONE |
| `values()` | All values (flat) | DONE |
| `entrySet()` | All [key,value] pairs | DONE |
| `containsKey(key)` | Key presence | DONE |
| `containsValue(value)` | Value scan | DONE |
| `containsEntry(key, value)` | Pair presence | DONE |
| `size()` | Total entry count | DONE |
| `valueCount(key)` | Value count per key | DONE |
| `clear()` | Remove all | DONE |
| `lock(key)` | Key lock | MISSING |
| `tryLock(key)` | Non-blocking lock | MISSING |
| `unlock(key)` | Unlock | MISSING |
| `forceUnlock(key)` | Force unlock | MISSING |
| `addEntryListener(listener)` | Entry events | MISSING |
| `removeEntryListener(id)` | Deregister | MISSING |
| `getLocalMultiMapStats()` | Local stats | MISSING |
| Client codecs | 0x020x00 series | MISSING |

---

## 10. ReplicatedMap

Server-side: `src/replicatedmap/impl/ReplicatedMapImpl.ts`

| Method | Description | Status |
|---|---|---|
| `put(key, value)` | Replicate entry | DONE |
| `put(key, value, ttl)` | Put with TTL | MISSING |
| `get(key)` | Get replicated value | DONE |
| `remove(key)` | Remove replicated entry | DONE |
| `clear()` | Remove all | DONE |
| `containsKey(key)` | Key check | DONE |
| `containsValue(value)` | Value scan | DONE |
| `size()` | Entry count | DONE |
| `isEmpty()` | Empty check | DONE |
| `keySet()` | All keys | DONE |
| `values()` | All values | DONE |
| `entrySet()` | All entries | DONE |
| `addEntryListener(listener)` | Entry events | MISSING |
| `removeEntryListener(id)` | Deregister | MISSING |
| `getLocalReplicatedMapStats()` | Stats | MISSING |
| Client codecs | 0x070x00 series | MISSING |

---

## 11. ICache (JCache JSR-107)

Server-side: `src/cache/impl/CacheRecordStore.ts`, `src/cache/HazelcastCacheManager.ts`

| Method | Description | Status |
|---|---|---|
| `put(key, value)` | Cache put | PARTIAL |
| `get(key)` | Cache get | PARTIAL |
| `remove(key)` | Cache remove | PARTIAL |
| `clear()` | Clear cache | PARTIAL |
| `containsKey(key)` | Key check | PARTIAL |
| `putAll(map)` | Bulk put | MISSING |
| `getAll(keys)` | Bulk get | MISSING |
| `putIfAbsent(key, value)` | Conditional put | MISSING |
| `replace(key, value)` | Replace | MISSING |
| `invoke(key, processor)` | Entry processor | MISSING |
| `invokeAll(keys, processor)` | Bulk entry processor | MISSING |
| Expiry policy | TTL via ExpiryPolicy | PARTIAL |
| Event listeners (CacheEntryListener) | Created/updated/removed/expired events | MISSING |
| Near Cache for ICache | Client-side near cache | PARTIAL |
| Eviction policies | LRU/LFU/RANDOM/NONE | PARTIAL (entry count check exists) |
| Client codecs | 0x150x00 series | MISSING |

---

## 12. FlakeIdGenerator

| Method | Description | Status |
|---|---|---|
| `newId()` | Generate globally unique ID | MISSING |
| Auto-batching | Client-side ID batching | MISSING |
| Client codec | 0x1E0100 | MISSING |

---

## 13. PNCounter

| Method | Description | Status |
|---|---|---|
| `get()` | Get current count | MISSING |
| `getAndAdd(delta)` | Atomic add, return old | MISSING |
| `getAndSubtract(delta)` | Atomic subtract, return old | MISSING |
| `addAndGet(delta)` | Atomic add, return new | MISSING |
| `subtractAndGet(delta)` | Atomic subtract, return new | MISSING |
| `getAndIncrement()` | Increment, return old | MISSING |
| `getAndDecrement()` | Decrement, return old | MISSING |
| `incrementAndGet()` | Increment, return new | MISSING |
| `decrementAndGet()` | Decrement, return new | MISSING |
| `reset()` | Reset counter state | MISSING |
| Client codec | 0x200x00 series | MISSING |

---

## 14. CardinalityEstimator

Server-side: `src/cardinality/HyperLogLog.ts`, `src/cardinality/impl/HyperLogLogImpl.ts`

| Method | Description | Status |
|---|---|---|
| `add(item)` | Add item to estimate | DONE (HLL internal) |
| `estimate()` | Return cardinality estimate | DONE (HLL internal) |
| Distributed proxy (ICardinalityEstimator) | Client/server proxy | MISSING |
| `aggregate(estimators)` | Merge multiple estimators | MISSING |
| Client codec | 0x200400 series | MISSING |

---

## 15. IExecutorService

Server-side: `src/executor/impl/ExecutorServiceProxy.ts`  
Remote status: protocol-capable on the server; no supported official-client proof at the pinned package boundary.

| Method | Description | Status |
|---|---|---|
| `execute(runnable)` | Fire-and-forget execution | DONE |
| `submit(callable)` | Execute, return future | DONE |
| `submitToMember(callable, member)` | Member-targeted execution | DONE |
| `submitToMembers(callable, members)` | Multi-member execution | PARTIAL |
| `submitToAllMembers(callable)` | All-member execution | DONE |
| `submitToKeyOwner(callable, key)` | Partition-owner execution | DONE |
| `executeOnMember(runnable, member)` | Fire-and-forget on member | DONE |
| `executeOnMembers(runnable, members)` | Fire-and-forget multi-member | PARTIAL |
| `executeOnAllMembers(runnable)` | Fire-and-forget all | DONE |
| `invokeAll(callables)` | Execute multiple, get all results | PARTIAL |
| `invokeAny(callables)` | Execute multiple, get first result | MISSING |
| `cancel(future)` | Cancel pending task | DONE |
| `isShutdown()` | Shutdown state | DONE |
| `isTerminated()` | Terminated state | DONE |
| `shutdown()` | Initiate shutdown | DONE |
| `shutdownNow()` | Force shutdown | DONE |
| Client codecs | 0x0E0x00 series | MISSING |

---

## 16. IScheduledExecutorService

Server-side: `src/scheduledexecutor/impl/ScheduledExecutorServiceProxy.ts`  
Protocol handlers: `src/server/clientprotocol/ScheduledExecutorMessageHandlers.ts`

| Method | Description | Status |
|---|---|---|
| `schedule(task, delay)` | One-shot delayed task | DONE |
| `scheduleAtFixedRate(task, delay, period)` | Recurring task | DONE |
| `scheduleOnMember(task, member, delay)` | Member-targeted one-shot | DONE |
| `scheduleOnMemberAtFixedRate(task, member, delay, period)` | Member-targeted recurring | DONE |
| `scheduleOnKeyOwner(task, key, delay)` | Partition-owner one-shot | DONE |
| `scheduleOnKeyOwnerAtFixedRate(task, key, delay, period)` | Partition-owner recurring | DONE |
| `scheduleOnAllMembers(task, delay)` | All-member one-shot | MISSING |
| `scheduleOnAllMembersAtFixedRate(task, delay, period)` | All-member recurring | MISSING |
| `getAllScheduledFutures()` | List all futures | DONE |
| `shutdown()` | Shutdown executor | DONE |
| IScheduledFuture.cancel(mayInterrupt)` | Cancel future | DONE |
| IScheduledFuture.getDelay()` | Remaining delay | DONE |
| IScheduledFuture.isDone()` | Completion check | DONE |
| IScheduledFuture.isCancelled()` | Cancellation check | DONE |
| IScheduledFuture.get()` | Wait for result | PARTIAL |
| IScheduledFuture.getStatistics()` | Execution stats | DONE |
| IScheduledFuture.dispose()` | Dispose future | DONE |
| Client codecs | 0x1A0x00 series | DONE (7 codecs) |

---

## 17. SQL Service

| Method | Description | Status |
|---|---|---|
| `sql.execute(sql, params)` | Execute SQL query | MISSING |
| `sql.execute(SqlStatement)` | Execute with statement object | MISSING |
| SqlResult iteration | Iterate over rows | MISSING |
| SqlColumnMetadata | Column type information | MISSING |
| Portable/Compact mapping | JSON/Portable map mapping | MISSING |
| Client codecs | 0x210x00 series | MISSING |

---

## 18. Transaction Support

Server-side: `src/transaction/impl/TransactionImpl.ts`, `src/transaction/TransactionContext.ts`

| Method | Description | Status |
|---|---|---|
| `newTransactionContext()` | Create transaction context | PARTIAL |
| `transactionContext.beginTransaction()` | Start transaction | DONE |
| `transactionContext.commitTransaction()` | Commit | DONE |
| `transactionContext.rollbackTransaction()` | Rollback | DONE |
| `transactionContext.getMap(name)` | Get transactional map | PARTIAL |
| `transactionContext.getQueue(name)` | Get transactional queue | MISSING |
| `transactionContext.getSet(name)` | Get transactional set | MISSING |
| `transactionContext.getList(name)` | Get transactional list | MISSING |
| `transactionContext.getMultiMap(name)` | Get transactional multimap | MISSING |
| Two-phase commit (2PC) | XA transaction support | MISSING |
| Transaction timeout | Configurable TX timeout | MISSING |
| Durable client TX | Client crash recovery | MISSING |
| Client codecs | 0x160x00 series | MISSING |

---

## 19. CP Subsystem

| Service | Description | Status |
|---|---|---|
| `cpSubsystem.getAtomicLong(name)` | Distributed AtomicLong | MISSING |
| `cpSubsystem.getAtomicReference(name)` | Distributed AtomicReference | MISSING |
| `cpSubsystem.getCountDownLatch(name)` | Distributed CountDownLatch | MISSING |
| `cpSubsystem.getSemaphore(name)` | Distributed Semaphore | MISSING |
| `cpSubsystem.getLock(name)` | Distributed FencedLock | MISSING |
| `cpSubsystem.getCPMap(name)` | CP Map (linearizable) | MISSING |
| Raft consensus | CP subsystem Raft backbone | MISSING |
| CP session management | CP session keep-alive | MISSING |
| Client codecs | 0x270x00+ series | MISSING |

---

## 20. Near Cache

Server-side: `src/internal/nearcache/` and `src/map/impl/nearcache/`  
Remote boundary: only the official `hazelcast-client` package is supported; Helios ships no proprietary client near-cache runtime.

| Feature | Description | Status |
|---|---|---|
| Map near cache (server) | In-process read cache | PARTIAL |
| Map near cache (client) | Client-side near cache | PARTIAL |
| ICache near cache | Cache near cache | PARTIAL |
| Invalidation protocol | Server→client invalidations | PARTIAL |
| Near cache preloader | Persist/reload near cache | MISSING |
| NearCacheConfig | TTL, maxIdle, maxSize, policy | PARTIAL |
| Stats reporting | Near cache hit/miss stats | PARTIAL |

---

## 21. Listeners & Events

| Listener Type | Description | Status |
|---|---|---|
| EntryListener (map) | ADDED/UPDATED/REMOVED/EVICTED | DONE |
| EntryListener (map, key-filtered) | Per-key events | MISSING |
| EntryListener (map, predicate-filtered) | Predicate-filtered events | MISSING |
| MapPartitionLostListener | Partition loss events | DONE |
| MapClearedListener | Map clear events | DONE |
| ItemListener (queue/set/list) | ADDED/REMOVED item events | DONE |
| MessageListener (topic) | Topic message events | DONE |
| MembershipListener | JOIN/LEAVE member events | PARTIAL |
| LifecycleListener | STARTING/STARTED/SHUTTING_DOWN/SHUTDOWN/CLIENT_CONNECTED | DONE |
| DistributedObjectListener | Object CREATED/DESTROYED | MISSING |
| MigrationListener | Partition migration events | MISSING |
| PartitionLostListener (global) | Global partition loss | PARTIAL |

---

## 22. Predicates

Source: `src/query/impl/predicates/`, `src/query/Predicates.ts`

| Predicate | Description | Status |
|---|---|---|
| `Predicates.equal(attr, val)` | Equality | DONE |
| `Predicates.notEqual(attr, val)` | Inequality | DONE |
| `Predicates.greaterThan(attr, val)` | GT comparison | DONE |
| `Predicates.greaterEqual(attr, val)` | GTE comparison | DONE |
| `Predicates.lessThan(attr, val)` | LT comparison | DONE |
| `Predicates.lessEqual(attr, val)` | LTE comparison | DONE |
| `Predicates.between(attr, from, to)` | Range | DONE |
| `Predicates.in(attr, ...values)` | Set membership | DONE |
| `Predicates.like(attr, expr)` | SQL LIKE pattern | DONE |
| `Predicates.ilike(attr, expr)` | Case-insensitive LIKE | DONE |
| `Predicates.regex(attr, regex)` | Regex match | DONE |
| `Predicates.and(...predicates)` | Logical AND | DONE |
| `Predicates.or(...predicates)` | Logical OR | DONE |
| `Predicates.not(predicate)` | Logical NOT | DONE |
| `Predicates.truePredicate()` | Always true | DONE |
| `Predicates.falsePredicate()` | Always false | DONE |
| `PagingPredicate` | Paginated results | MISSING |
| `PartitionPredicate` | Partition-targeted query | MISSING |
| Index-accelerated predicates | Use SortedIndex/HashIndex | DONE |

---

## 23. Aggregators

Source: `src/aggregation/`

| Aggregator | Description | Status |
|---|---|---|
| `Aggregators.count()` | Count entries | DONE |
| `Aggregators.sum(attr)` | Integer sum | DONE |
| `Aggregators.longSum(attr)` | Long sum | DONE |
| `Aggregators.doubleSum(attr)` | Double sum | DONE |
| `Aggregators.bigDecimalSum(attr)` | BigDecimal sum | DONE |
| `Aggregators.bigIntegerSum(attr)` | BigInteger sum | DONE |
| `Aggregators.avg(attr)` | Integer average | DONE |
| `Aggregators.longAvg(attr)` | Long average | DONE |
| `Aggregators.doubleAvg(attr)` | Double average | DONE |
| `Aggregators.bigDecimalAvg(attr)` | BigDecimal average | DONE |
| `Aggregators.bigIntegerAvg(attr)` | BigInteger average | DONE |
| `Aggregators.numberAvg(attr)` | Generic number average | DONE |
| `Aggregators.max(attr)` | Maximum value | DONE |
| `Aggregators.maxBy(attr)` | Entry with max | DONE |
| `Aggregators.min(attr)` | Minimum value | DONE |
| `Aggregators.minBy(attr)` | Entry with min | DONE |
| `Aggregators.distinct(attr)` | Distinct values | DONE |
| `Aggregators.floatingPointSum(attr)` | Floating-point sum | DONE |
| `Aggregators.fixedPointSum(attr)` | Fixed-point sum | DONE |

---

## 24. EntryProcessors

| Feature | Description | Status |
|---|---|---|
| `AbstractEntryProcessor` | Base class for entry processors | MISSING |
| `executeOnKey(key, processor)` | Single-key entry processor | MISSING |
| `executeOnKeys(keys, processor)` | Multi-key entry processor | MISSING |
| `executeOnEntries(processor)` | All-entries processor | MISSING |
| `executeOnEntries(processor, predicate)` | Filtered processor | MISSING |
| `submitToKey(key, processor)` | Async entry processor | MISSING |

---

## 25. Projections

| Feature | Description | Status |
|---|---|---|
| `Projections.singleAttribute(attr)` | Extract single attribute | MISSING |
| `Projections.multiAttribute(attrs...)` | Extract multiple attributes | MISSING |
| `Projections.identity()` | Return value unchanged | MISSING |
| `map.project(projection)` | Apply projection to all entries | MISSING |
| `map.project(projection, predicate)` | Filtered projection | MISSING |

---

## 26. Serialization

Source: `src/internal/serialization/`

| Feature | Description | Status |
|---|---|---|
| Java primitive types | int, long, boolean, double, etc. | DONE |
| String serialization | UTF-8 string encoding | DONE |
| `IdentifiedDataSerializable` | Fast Java-compatible serialization | PARTIAL |
| `Portable` | Schema-aware cross-language serialization | MISSING |
| `Compact` | Schema-less compact format (HZ 5.x) | MISSING |
| JSON serialization | `HazelcastJsonValue` wrapper | PARTIAL |
| Custom serializers | Pluggable serializer registry | PARTIAL |
| Global serializer | Catch-all serializer | MISSING |
| `DataSerializable` | Basic Java `DataSerializable` | PARTIAL |
| `ByteArraySerializer` | Raw byte serializer | PARTIAL |
| `StreamSerializer` | Streaming serializer | MISSING |
| Versioned portable | Schema versioning | MISSING |
| Generic record API | Schema-agnostic record access | MISSING |

---

## 27. Cluster & Membership

Source: `src/internal/cluster/`, `src/cluster/`

| Feature | Description | Status |
|---|---|---|
| Member list | Local member list tracking | DONE |
| Cluster name validation | Reject wrong cluster | DONE |
| TCP-IP join | Member discovery via explicit IP list | DONE |
| Multicast join | UDP multicast discovery | DONE |
| Member attribute access | Read member attributes | PARTIAL |
| Cluster state management | ACTIVE/FROZEN/PASSIVE/etc. | PARTIAL |
| Split-brain detection | Network partition detection | PARTIAL |
| Split-brain protection | Quorum-based operation guarding | MISSING |
| Blue/green failover | Failover cluster config | PARTIAL |

---

## 28. Connection Management

Source: `src/server/clientprotocol/`, official-client interop in `test/interop/`

| Feature | Description | Status |
|---|---|---|
| TCP client connection | Connect to server | DONE |
| Authentication | Username/password auth | DONE |
| Token authentication | Token-based auth | MISSING |
| Kerberos / LDAP | Enterprise auth | MISSING |
| TLS/SSL | Encrypted transport | MISSING |
| Connection retry | Exponential backoff retry | PARTIAL |
| Heartbeat | Client-side keep-alive | DONE |
| Smart routing | Partition-owner routing | PARTIAL |
| Non-smart routing | Single-endpoint routing | PARTIAL |
| Load balancing | Round-robin / random LB | MISSING |

---

## 29. Partition Service

Source: `src/internal/partition/`, `src/spi/PartitionService.ts`

| Feature | Description | Status |
|---|---|---|
| Partition table (271 partitions) | Fixed partition count | DONE |
| Partition key routing | Hash-based partition assignment | DONE |
| Migration | Partition migration between members | DONE |
| Anti-entropy | Background replica sync | DONE |
| Backup replication | Sync replica maintenance | DONE |
| Partition-lost detection | All-replica-lost detection | DONE |
| Partition recovery | Backup promotion | DONE |

---

## 30. Configuration

Source: `src/config/`

| Config Class | Description | Status |
|---|---|---|
| Official `hazelcast-client` config | Remote-client config surface | External package |
| `NearCacheConfig` | Near cache options | PARTIAL |
| `SerializationConfig` | Serializer registry | PARTIAL |
| `MapConfig` | Map eviction/TTL/backups | PARTIAL |
| `QueueConfig` | Queue capacity/backups | PARTIAL |
| `TopicConfig` | Topic configuration | PARTIAL |
| `RingbufferConfig` | Ringbuffer capacity/TTL | DONE |
| `ReliableTopicConfig` | Reliable topic settings | PARTIAL |
| `EvictionConfig` | Eviction policy/size | PARTIAL |
| `IndexConfig` | Map index configuration | DONE |
| XML/YAML config file loading | File-based configuration | MISSING |
| System property overrides | JVM-style `-D` property override | PARTIAL |
