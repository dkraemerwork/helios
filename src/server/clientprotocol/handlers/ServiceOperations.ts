/**
 * Block C — Service Operation Interfaces
 *
 * Defines the operation interfaces that handlers delegate to.
 * These are the contracts between thin protocol handlers and the
 * underlying service implementations.
 *
 * All operations accept serialized Data objects (not typed values) to keep
 * handlers free of serialization concerns.  The service layer is responsible
 * for deserializing Data → typed value and serializing back.
 *
 * Port of Hazelcast service interfaces:
 *   MapService, QueueService, TopicService, ListService, SetService,
 *   MultiMapService, ReplicatedMapService, RingbufferService, etc.
 */

import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import type { SimpleEntryView } from '@zenystx/helios-core/map/impl/SimpleEntryView.js';
import type { ClientSession } from '@zenystx/helios-core/server/clientprotocol/ClientSession.js';

// ── Map ───────────────────────────────────────────────────────────────────────

export interface MapServiceOperations {
    put(name: string, key: Data, value: Data, threadId: bigint, ttl: bigint): Promise<Data | null>;
    get(name: string, key: Data, threadId: bigint): Promise<Data | null>;
    remove(name: string, key: Data, threadId: bigint): Promise<Data | null>;
    size(name: string): Promise<number>;
    containsKey(name: string, key: Data, threadId: bigint): Promise<boolean>;
    containsValue(name: string, value: Data): Promise<boolean>;
    clear(name: string): Promise<void>;
    delete(name: string, key: Data, threadId: bigint): Promise<void>;
    set(name: string, key: Data, value: Data, threadId: bigint, ttl: bigint): Promise<void>;
    getAll(name: string, keys: Data[]): Promise<Array<[Data, Data]>>;
    putAll(name: string, entries: Array<[Data, Data]>, triggerMapLoader: boolean): Promise<void>;
    getEntryView(name: string, key: Data, threadId: bigint): Promise<SimpleEntryView<Data, Data> | null>;
    evict(name: string, key: Data, threadId: bigint): Promise<boolean>;
    evictAll(name: string): Promise<void>;
    flush(name: string): Promise<void>;
    keySet(name: string): Promise<Data[]>;
    values(name: string): Promise<Data[]>;
    entrySet(name: string): Promise<Array<[Data, Data]>>;
    tryPut(name: string, key: Data, value: Data, threadId: bigint, timeout: bigint): Promise<boolean>;
    putIfAbsent(name: string, key: Data, value: Data, threadId: bigint, ttl: bigint): Promise<Data | null>;
    replace(name: string, key: Data, value: Data, threadId: bigint): Promise<Data | null>;
    replaceIfSame(name: string, key: Data, oldValue: Data, newValue: Data, threadId: bigint): Promise<boolean>;
    removeIfSame(name: string, key: Data, value: Data, threadId: bigint): Promise<boolean>;
    lock(name: string, key: Data, threadId: bigint, ttl: bigint, referenceId: bigint): Promise<void>;
    unlock(name: string, key: Data, threadId: bigint, referenceId: bigint): Promise<void>;
    tryLock(name: string, key: Data, threadId: bigint, lease: bigint, timeout: bigint, referenceId: bigint): Promise<boolean>;
    isLocked(name: string, key: Data): Promise<boolean>;
    forceUnlock(name: string, key: Data, referenceId: bigint): Promise<void>;
    addEntryListener(name: string, flags: number, localOnly: boolean, correlationId: number, session: ClientSession): Promise<string>;
    removeEntryListener(registrationId: string, session: ClientSession): Promise<boolean>;
    removeInterceptor(name: string, id: string): Promise<boolean>;
    executeOnKey(name: string, key: Data, entryProcessor: Data, threadId: bigint): Promise<Data | null>;
    executeOnAllKeys(name: string, entryProcessor: Data): Promise<Array<[Data, Data]>>;
    executeWithPredicate(name: string, entryProcessor: Data, predicate: Data): Promise<Array<[Data, Data]>>;
    executeOnKeys(name: string, keys: Data[], entryProcessor: Data): Promise<Array<[Data, Data]>>;
    setTtl(name: string, key: Data, ttl: bigint): Promise<boolean>;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export interface QueueServiceOperations {
    offer(name: string, value: Data, timeoutMs: bigint): Promise<boolean>;
    poll(name: string, timeoutMs: bigint): Promise<Data | null>;
    peek(name: string): Promise<Data | null>;
    size(name: string): Promise<number>;
    clear(name: string): Promise<void>;
    isEmpty(name: string): Promise<boolean>;
    contains(name: string, value: Data): Promise<boolean>;
    containsAll(name: string, values: Data[]): Promise<boolean>;
    addAll(name: string, values: Data[]): Promise<boolean>;
    removeAll(name: string, values: Data[]): Promise<boolean>;
    retainAll(name: string, values: Data[]): Promise<boolean>;
    drain(name: string, maxElements: number): Promise<Data[]>;
    iterator(name: string): Promise<Data[]>;
    remainingCapacity(name: string): Promise<number>;
    take(name: string): Promise<Data | null>;
    put(name: string, value: Data): Promise<void>;
    addItemListener(name: string, includeValue: boolean, correlationId: number, session: ClientSession): Promise<string>;
    removeItemListener(registrationId: string, session: ClientSession): Promise<boolean>;
}

// ── Topic ─────────────────────────────────────────────────────────────────────

export interface TopicServiceOperations {
    publish(name: string, message: Data): Promise<void>;
    publishAll(name: string, messages: Data[]): Promise<void>;
    addMessageListener(name: string, correlationId: number, session: ClientSession): Promise<string>;
    removeMessageListener(registrationId: string, session: ClientSession): Promise<boolean>;
}

// ── List ──────────────────────────────────────────────────────────────────────

export interface ListServiceOperations {
    add(name: string, value: Data): Promise<boolean>;
    addWithIndex(name: string, index: number, value: Data): Promise<void>;
    get(name: string, index: number): Promise<Data | null>;
    set(name: string, index: number, value: Data): Promise<Data | null>;
    remove(name: string, value: Data): Promise<boolean>;
    removeWithIndex(name: string, index: number): Promise<Data | null>;
    size(name: string): Promise<number>;
    contains(name: string, value: Data): Promise<boolean>;
    containsAll(name: string, values: Data[]): Promise<boolean>;
    addAll(name: string, values: Data[]): Promise<boolean>;
    addAllWithIndex(name: string, index: number, values: Data[]): Promise<boolean>;
    clear(name: string): Promise<void>;
    indexOf(name: string, value: Data): Promise<number>;
    lastIndexOf(name: string, value: Data): Promise<number>;
    iterator(name: string): Promise<Data[]>;
    subList(name: string, from: number, to: number): Promise<Data[]>;
    addItemListener(name: string, includeValue: boolean, correlationId: number, session: ClientSession): Promise<string>;
    removeItemListener(registrationId: string, session: ClientSession): Promise<boolean>;
    isEmpty(name: string): Promise<boolean>;
    removeAll(name: string, values: Data[]): Promise<boolean>;
    retainAll(name: string, values: Data[]): Promise<boolean>;
}

// ── Set ───────────────────────────────────────────────────────────────────────

export interface SetServiceOperations {
    add(name: string, value: Data): Promise<boolean>;
    remove(name: string, value: Data): Promise<boolean>;
    size(name: string): Promise<number>;
    contains(name: string, value: Data): Promise<boolean>;
    containsAll(name: string, values: Data[]): Promise<boolean>;
    addAll(name: string, values: Data[]): Promise<boolean>;
    removeAll(name: string, values: Data[]): Promise<boolean>;
    retainAll(name: string, values: Data[]): Promise<boolean>;
    clear(name: string): Promise<void>;
    iterator(name: string): Promise<Data[]>;
    isEmpty(name: string): Promise<boolean>;
    addItemListener(name: string, includeValue: boolean, correlationId: number, session: ClientSession): Promise<string>;
    removeItemListener(registrationId: string, session: ClientSession): Promise<boolean>;
}

// ── MultiMap ──────────────────────────────────────────────────────────────────

export interface MultiMapServiceOperations {
    put(name: string, key: Data, value: Data, threadId: bigint): Promise<boolean>;
    get(name: string, key: Data, threadId: bigint): Promise<Data[]>;
    remove(name: string, key: Data, threadId: bigint): Promise<Data[]>;
    removeEntry(name: string, key: Data, value: Data, threadId: bigint): Promise<boolean>;
    size(name: string): Promise<number>;
    containsKey(name: string, key: Data, threadId: bigint): Promise<boolean>;
    containsValue(name: string, value: Data): Promise<boolean>;
    containsEntry(name: string, key: Data, value: Data, threadId: bigint): Promise<boolean>;
    clear(name: string): Promise<void>;
    keySet(name: string): Promise<Data[]>;
    values(name: string): Promise<Data[]>;
    entrySet(name: string): Promise<Array<[Data, Data]>>;
    valueCount(name: string, key: Data, threadId: bigint): Promise<number>;
    lock(name: string, key: Data, threadId: bigint, ttl: bigint, referenceId: bigint): Promise<void>;
    unlock(name: string, key: Data, threadId: bigint, referenceId: bigint): Promise<void>;
    tryLock(name: string, key: Data, threadId: bigint, lease: bigint, timeout: bigint, referenceId: bigint): Promise<boolean>;
    isLocked(name: string, key: Data): Promise<boolean>;
    forceUnlock(name: string, key: Data): Promise<void>;
    addEntryListener(name: string, includeValue: boolean, localOnly: boolean, correlationId: number, session: ClientSession): Promise<string>;
    removeEntryListener(registrationId: string, session: ClientSession): Promise<boolean>;
    putAll(name: string, key: Data, values: Data[], threadId: bigint): Promise<void>;
}

// ── ReplicatedMap ─────────────────────────────────────────────────────────────

export interface ReplicatedMapServiceOperations {
    put(name: string, key: Data, value: Data, ttl: bigint): Promise<Data | null>;
    get(name: string, key: Data): Promise<Data | null>;
    remove(name: string, key: Data): Promise<Data | null>;
    size(name: string): Promise<number>;
    containsKey(name: string, key: Data): Promise<boolean>;
    containsValue(name: string, value: Data): Promise<boolean>;
    clear(name: string): Promise<void>;
    keySet(name: string): Promise<Data[]>;
    values(name: string): Promise<Data[]>;
    entrySet(name: string): Promise<Array<[Data, Data]>>;
    putAll(name: string, entries: Array<[Data, Data]>): Promise<void>;
    isEmpty(name: string): Promise<boolean>;
    addEntryListener(name: string, correlationId: number, session: ClientSession): Promise<string>;
    removeEntryListener(registrationId: string, session: ClientSession): Promise<boolean>;
    addEntryListenerWithKey(name: string, key: Data, correlationId: number, session: ClientSession): Promise<string>;
    addEntryListenerWithPredicate(name: string, predicate: Data, correlationId: number, session: ClientSession): Promise<string>;
    addEntryListenerWithKeyAndPredicate(name: string, key: Data, predicate: Data, correlationId: number, session: ClientSession): Promise<string>;
}

// ── Ringbuffer ────────────────────────────────────────────────────────────────

export interface RingbufferServiceOperations {
    capacity(name: string): Promise<bigint>;
    size(name: string): Promise<bigint>;
    tailSequence(name: string): Promise<bigint>;
    headSequence(name: string): Promise<bigint>;
    remainingCapacity(name: string): Promise<bigint>;
    add(name: string, overflowPolicy: number, value: Data): Promise<bigint>;
    addAll(name: string, values: Data[], overflowPolicy: number): Promise<bigint>;
    readOne(name: string, sequence: bigint): Promise<Data | null>;
    readMany(name: string, startSequence: bigint, minCount: number, maxCount: number, filter: Data | null): Promise<{ readCount: number; items: Data[]; itemSeqs: bigint[] | null; nextSeq: bigint }>;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

export interface CacheServiceOperations {
    get(name: string, key: Data, expiryPolicy: Data | null): Promise<Data | null>;
    put(name: string, key: Data, value: Data, expiryPolicy: Data | null, isGet: boolean, completionId: number): Promise<Data | null>;
    remove(name: string, key: Data, currentValue: Data | null, completionId: number): Promise<boolean>;
    size(name: string): Promise<number>;
    clear(name: string): Promise<void>;
    containsKey(name: string, key: Data): Promise<boolean>;
    getAndPut(name: string, key: Data, value: Data, expiryPolicy: Data | null, completionId: number): Promise<Data | null>;
    getAndRemove(name: string, key: Data, completionId: number): Promise<Data | null>;
    getAndReplace(name: string, key: Data, value: Data, expiryPolicy: Data | null, completionId: number): Promise<Data | null>;
    putIfAbsent(name: string, key: Data, value: Data, expiryPolicy: Data | null, completionId: number): Promise<boolean>;
    replace(name: string, key: Data, oldValue: Data | null, newValue: Data, expiryPolicy: Data | null, completionId: number): Promise<boolean>;
    getAll(name: string, keys: Data[], expiryPolicy: Data | null): Promise<Array<[Data, Data]>>;
    putAll(name: string, entries: Array<[Data, Data]>, expiryPolicy: Data | null, completionId: number): Promise<void>;
    removeAll(name: string, keys: Data[] | null, completionId: number): Promise<void>;
    destroy(name: string): Promise<void>;
    addInvalidationListener(name: string, localOnly: boolean, session: ClientSession): Promise<string>;
    removeInvalidationListener(registrationId: string, session: ClientSession): Promise<boolean>;
}

// ── Transaction ───────────────────────────────────────────────────────────────

export interface TransactionServiceOperations {
    create(timeoutMs: bigint, durability: number, transactionType: number, threadId: bigint): Promise<string>;
    commit(txId: string, onePhase: boolean): Promise<void>;
    rollback(txId: string): Promise<void>;
    mapGet(txId: string, name: string, key: Data, threadId: bigint): Promise<Data | null>;
    mapPut(txId: string, name: string, key: Data, value: Data, threadId: bigint, ttl: bigint): Promise<Data | null>;
    mapSet(txId: string, name: string, key: Data, value: Data, threadId: bigint, ttl: bigint): Promise<void>;
    mapPutIfAbsent(txId: string, name: string, key: Data, value: Data, threadId: bigint): Promise<Data | null>;
    mapRemove(txId: string, name: string, key: Data, threadId: bigint): Promise<Data | null>;
    mapDelete(txId: string, name: string, key: Data, threadId: bigint): Promise<void>;
    mapKeySet(txId: string, name: string): Promise<Data[]>;
    mapValues(txId: string, name: string): Promise<Data[]>;
    queueOffer(txId: string, name: string, value: Data, timeout: bigint, threadId: bigint): Promise<boolean>;
    queuePoll(txId: string, name: string, timeout: bigint, threadId: bigint): Promise<Data | null>;
    queuePeek(txId: string, name: string, timeout: bigint, threadId: bigint): Promise<Data | null>;
    queueSize(txId: string, name: string, threadId: bigint): Promise<number>;
    listAdd(txId: string, name: string, value: Data, threadId: bigint): Promise<boolean>;
    listRemove(txId: string, name: string, value: Data, threadId: bigint): Promise<boolean>;
    listSize(txId: string, name: string, threadId: bigint): Promise<number>;
    listGet(txId: string, name: string, index: number, threadId: bigint): Promise<Data | null>;
    listSet(txId: string, name: string, index: number, value: Data, threadId: bigint): Promise<Data | null>;
    setAdd(txId: string, name: string, value: Data, threadId: bigint): Promise<boolean>;
    setRemove(txId: string, name: string, value: Data, threadId: bigint): Promise<boolean>;
    multimapPut(txId: string, name: string, key: Data, value: Data, threadId: bigint): Promise<boolean>;
    multimapRemove(txId: string, name: string, key: Data, value: Data, threadId: bigint): Promise<boolean>;
    multimapGet(txId: string, name: string, key: Data, threadId: bigint): Promise<Data[]>;
    multimapValueCount(txId: string, name: string, key: Data, threadId: bigint): Promise<number>;
}

// ── SQL ───────────────────────────────────────────────────────────────────────

export interface SqlServiceOperations {
    execute(
        sql: string,
        params: Data[],
        timeoutMs: bigint,
        cursorBufferSize: number,
        partitionArgumentIndex: number,
        queryId: { localHigh: bigint; localLow: bigint; globalHigh: bigint; globalLow: bigint },
        returnRawResult: boolean,
        schema: string | null,
        expectedResultType: number,
    ): Promise<SqlExecuteResult>;
    fetch(queryId: { localHigh: bigint; localLow: bigint; globalHigh: bigint; globalLow: bigint }, cursorBufferSize: number): Promise<SqlFetchResult>;
    close(queryId: { localHigh: bigint; localLow: bigint; globalHigh: bigint; globalLow: bigint }): Promise<void>;
}

export interface SqlExecuteResult {
    queryId: { localHigh: bigint; localLow: bigint; globalHigh: bigint; globalLow: bigint };
    rowMetadata: SqlColumnMetadata[] | null;
    rowPage: SqlPage | null;
    updateCount: bigint;
    error: SqlError | null;
    isInfiniteRows: boolean;
    partitionArgumentIndex: number;
}

export interface SqlFetchResult {
    rowPage: SqlPage | null;
    error: SqlError | null;
}

export interface SqlColumnMetadata {
    name: string;
    type: number;
    nullable: boolean;
    nullableIsSet: boolean;
}

export interface SqlPage {
    columnTypes: number[];
    columns: Data[][];
    last: boolean;
}

export interface SqlError {
    code: number;
    message: string;
    originatingMemberId: string;
    suggestion: string | null;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export interface ExecutorServiceOperations {
    shutdown(name: string): Promise<void>;
    isShutdown(name: string): Promise<boolean>;
    cancelOnPartition(uuid: string, partitionId: number, interrupt: boolean): Promise<boolean>;
    cancelOnMember(uuid: string, memberUuid: string, interrupt: boolean): Promise<boolean>;
    submitToPartition(name: string, uuid: string, callable: Data, partitionId: number): Promise<void>;
    submitToMember(name: string, uuid: string, callable: Data, memberUuid: string): Promise<void>;
}

// ── CP Subsystem ──────────────────────────────────────────────────────────────

export interface AtomicLongOperations {
    get(proxyName: string): Promise<bigint>;
    set(proxyName: string, value: bigint): Promise<void>;
    getAndSet(proxyName: string, value: bigint): Promise<bigint>;
    addAndGet(proxyName: string, delta: bigint): Promise<bigint>;
    getAndAdd(proxyName: string, delta: bigint): Promise<bigint>;
    compareAndSet(proxyName: string, expect: bigint, update: bigint): Promise<boolean>;
    incrementAndGet(proxyName: string): Promise<bigint>;
    getAndIncrement(proxyName: string): Promise<bigint>;
    decrementAndGet(proxyName: string): Promise<bigint>;
    getAndDecrement(proxyName: string): Promise<bigint>;
    apply(proxyName: string, function_: Data): Promise<Data | null>;
    alter(proxyName: string, function_: Data): Promise<void>;
    alterAndGet(proxyName: string, function_: Data): Promise<bigint>;
    getAndAlter(proxyName: string, function_: Data): Promise<bigint>;
}

export interface AtomicRefOperations {
    get(proxyName: string): Promise<Data | null>;
    set(proxyName: string, value: Data | null): Promise<void>;
    compareAndSet(proxyName: string, expected: Data | null, updated: Data | null): Promise<boolean>;
    isNull(proxyName: string): Promise<boolean>;
    clear(proxyName: string): Promise<void>;
    contains(proxyName: string, value: Data | null): Promise<boolean>;
    apply(proxyName: string, function_: Data): Promise<Data | null>;
    alter(proxyName: string, function_: Data): Promise<void>;
    alterAndGet(proxyName: string, function_: Data): Promise<Data | null>;
    getAndAlter(proxyName: string, function_: Data): Promise<Data | null>;
}

export interface CountDownLatchOperations {
    trySetCount(proxyName: string, count: number): Promise<boolean>;
    await(proxyName: string, timeoutMs: bigint): Promise<boolean>;
    countDown(proxyName: string, expectedRound: number, invocationUuid: string): Promise<void>;
    getCount(proxyName: string): Promise<number>;
    getRound(proxyName: string): Promise<number>;
}

export interface SemaphoreOperations {
    init(proxyName: string, permits: number): Promise<boolean>;
    acquire(proxyName: string, sessionId: bigint, threadId: bigint, invocationUuid: string, permits: number): Promise<void>;
    release(proxyName: string, sessionId: bigint, threadId: bigint, invocationUuid: string, permits: number): Promise<void>;
    drain(proxyName: string, sessionId: bigint, threadId: bigint, invocationUuid: string): Promise<number>;
    change(proxyName: string, sessionId: bigint, threadId: bigint, invocationUuid: string, permits: number): Promise<void>;
    availablePermits(proxyName: string): Promise<number>;
    tryAcquire(proxyName: string, sessionId: bigint, threadId: bigint, invocationUuid: string, permits: number, timeoutMs: bigint): Promise<boolean>;
}

// ── FlakeIdGenerator ──────────────────────────────────────────────────────────

export interface FlakeIdGeneratorOperations {
    newIdBatch(name: string, batchSize: number): Promise<{ base: bigint; increment: bigint; batchSize: number }>;
}

// ── PNCounter ─────────────────────────────────────────────────────────────────

export interface PnCounterOperations {
    get(name: string, replicaTimestamps: Array<[string, bigint]>, targetReplicaUUID: string): Promise<{ value: bigint; replicaTimestamps: Array<[string, bigint]> }>;
    add(name: string, delta: bigint, getBeforeUpdate: boolean, replicaTimestamps: Array<[string, bigint]>, targetReplicaUUID: string): Promise<{ value: bigint; replicaTimestamps: Array<[string, bigint]> }>;
    getConfiguredReplicaCount(name: string): Promise<number>;
}

// ── CardinalityEstimator ──────────────────────────────────────────────────────

export interface CardinalityEstimatorOperations {
    add(name: string, item: Data): Promise<void>;
    estimate(name: string): Promise<bigint>;
}
