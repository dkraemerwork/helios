# Helios Opcode Inventory — hazelcast-client@5.6.x / Protocol 2.8

**Target:** `hazelcast-client@5.6.0` / Hazelcast OSS `5.5.0`  
**Client Protocol Version:** 2.8  
**Audit date:** 2026-03-08  

## Opcode Encoding

Each message type is a 24-bit integer encoded as `serviceId (8 bits) | methodId (8 bits) | 0x00 (8 bits)` for requests and `| 0x01` for responses, `| 0x02+` for events. Wire encoding is little-endian.

Handler status legend:
- **DONE** — Codec implemented + server-side handler registered in `HeliosInstanceImpl` or `ScheduledExecutorMessageHandlers`
- **CODEC** — Codec exists but no server-side handler is wired
- **MISSING** — No codec and no handler

---

## Service 0x00 — Client (built-in)

| Opcode (hex) | Decimal | Method | Codec File | Handler File | Status |
|---|---|---|---|---|---|
| 0x000100 | 256 | ClientAuthentication | `ClientAuthenticationCodec.ts` | `ClientProtocolServer.ts` | DONE |
| 0x000200 | 512 | ClientAuthenticationCustom | — | — | MISSING |
| 0x000300 | 768 | ClientAddMembershipListener | — | — | MISSING |
| 0x000400 | 1024 | ClientCreateProxy | `ClientCreateProxyCodec.ts` | — | CODEC |
| 0x000500 | 1280 | ClientDestroyProxy | `ClientDestroyProxyCodec.ts` | — | CODEC |
| 0x000600 | 1536 | ClientGetPartitions | — | — | MISSING |
| 0x000700 | 1792 | ClientRemoveAllListeners | — | — | MISSING |
| 0x000800 | 2048 | ClientGetDistributedObjects | `ClientGetDistributedObjectsCodec.ts` | — | CODEC |
| 0x000900 | 2304 | ClientAddDistributedObjectListener | — | — | MISSING |
| 0x000A00 | 2560 | ClientRemoveDistributedObjectListener | — | — | MISSING |
| 0x000B00 | 2816 | ClientPing | — | — | MISSING |
| 0x000C00 | 3072 | ClientStatistics | — | — | MISSING |
| 0x000D00 | 3328 | ClientDeployClasses | — | — | MISSING |
| 0x000E00 | 3584 | ClientCreateProxies | — | — | MISSING |
| 0x000F00 | 3840 | ClientLocalBackupListener | — | — | MISSING |
| 0x001000 | 4096 | ClientTriggerPartitionAssignment | — | — | MISSING |
| 0x001100 | 4352 | ClientFetchSchema | — | — | MISSING |
| 0x001200 | 4608 | ClientSendSchema | — | — | MISSING |
| 0x001300 | 4864 | ClientTpcAuthentication | — | — | MISSING |

---

## Service 0x01 — Map

Handler registration: `src/instance/impl/HeliosInstanceImpl.ts`

| Opcode (hex) | Decimal | Method | Codec File | Handler | Status |
|---|---|---|---|---|---|
| 0x010100 | 65792 | MapPut | `MapPutCodec.ts` | `HeliosInstanceImpl._registerClientProtocolHandlers` | DONE |
| 0x010200 | 66048 | MapGet | `MapGetCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x010300 | 66304 | MapRemove | `MapRemoveCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x010400 | 66560 | MapContainsKey | `MapContainsKeyCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x010500 | 66816 | MapContainsValue | `MapContainsKeyCodec.ts` (shares file structure) | — | CODEC |
| 0x010600 | 67072 | MapSet | `MapSetCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x010700 | 67328 | MapDelete | `MapDeleteCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x010800 | 67584 | MapClear | `MapClearCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x010900 | 67840 | MapSize | `MapSizeCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x010A00 | 68096 | MapFlush | — | — | MISSING |
| 0x010B00 | 68352 | MapTryRemove | — | — | MISSING |
| 0x010C00 | 68608 | MapTryPut | — | — | MISSING |
| 0x010D00 | 68864 | MapPutTransient | — | — | MISSING |
| 0x010E00 | 69120 | MapPutIfAbsent | — | — | MISSING |
| 0x010F00 | 69376 | MapPutIfAbsentWithMaxIdle | — | — | MISSING |
| 0x011000 | 69632 | MapPutAll | — | — | MISSING |
| 0x011100 | 69888 | MapGetAll | — | — | MISSING |
| 0x011200 | 70144 | MapEvict | — | — | MISSING |
| 0x011300 | 70400 | MapEvictAll | — | — | MISSING |
| 0x011400 | 70656 | MapLoadAll | — | — | MISSING |
| 0x011500 | 70912 | MapLoadGivenKeys | — | — | MISSING |
| 0x011600 | 71168 | MapGetEntryView | — | — | MISSING |
| 0x011700 | 71424 | MapKeySet | — | — | MISSING |
| 0x011800 | 71680 | MapValues | — | — | MISSING |
| 0x011900 | 71936 | MapAddEntryListener | `MapAddEntryListenerCodec.ts` | — | CODEC |
| 0x011A00 | 72192 | MapAddEntryListenerWithPredicate | — | — | MISSING |
| 0x011B00 | 72448 | MapAddEntryListenerToKey | — | — | MISSING |
| 0x011C00 | 72704 | MapAddEntryListenerToKeyWithPredicate | — | — | MISSING |
| 0x011D00 | 72960 | MapRemoveEntryListener | — | — | MISSING |
| 0x011E00 | 73216 | MapAddNearCacheInvalidationListener | — | — | MISSING |
| 0x011F00 | 73472 | MapRemoveNearCacheInvalidationListener | — | — | MISSING |
| 0x012000 | 73728 | MapEntrySet | — | — | MISSING |
| 0x012100 | 73984 | MapIsLocked | — | — | MISSING |
| 0x012200 | 74240 | MapLock | — | — | MISSING |
| 0x012300 | 74496 | MapUnlock | — | — | MISSING |
| 0x012400 | 74752 | MapForceUnlock | — | — | MISSING |
| 0x012500 | 75008 | MapTryLock | — | — | MISSING |
| 0x012600 | 75264 | MapRemoveAll | — | — | MISSING |
| 0x012700 | 75520 | MapExecuteOnKey | — | — | MISSING |
| 0x012800 | 75776 | MapExecuteOnAllKeys | — | — | MISSING |
| 0x012900 | 76032 | MapExecuteWithPredicate | — | — | MISSING |
| 0x012A00 | 76288 | MapExecuteOnKeys | — | — | MISSING |
| 0x012B00 | 76544 | MapSubmitToKey | — | — | MISSING |
| 0x012C00 | 76800 | MapFetchKeys | — | — | MISSING |
| 0x012D00 | 77056 | MapFetchEntries | — | — | MISSING |
| 0x012E00 | 77312 | MapAggregateWithPredicate | — | — | MISSING |
| 0x012F00 | 77568 | MapAggregate | — | — | MISSING |
| 0x013000 | 77824 | MapProjectWithPredicate | — | — | MISSING |
| 0x013100 | 78080 | MapProject | — | — | MISSING |
| 0x013200 | 78336 | MapFetchNearCacheInvalidationMetadata | — | `MapFetchNearCacheInvalidationMetadataTask.ts` | PARTIAL |
| 0x013300 | 78592 | MapRemovePartitionLostListener | — | — | MISSING |
| 0x013400 | 78848 | MapAddPartitionLostListener | — | — | MISSING |
| 0x013500 | 79104 | MapGetLocalMapStats | — | — | MISSING |
| 0x013600 | 79360 | MapPutWithMaxIdle | — | — | MISSING |
| 0x013700 | 79616 | MapPutTransientWithMaxIdle | — | — | MISSING |
| 0x013800 | 79872 | MapPutIfAbsentWithMaxIdle | — | — | MISSING |
| 0x013900 | 80128 | MapSetWithMaxIdle | — | — | MISSING |
| 0x013A00 | 80384 | MapReplaceAll | — | — | MISSING |
| 0x013B00 | 80640 | MapReplace | — | — | MISSING |
| 0x013C00 | 80896 | MapReplaceIfSame | — | — | MISSING |

---

## Service 0x02 — MultiMap

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x020100 | 131328 | MultiMapPut | MISSING |
| 0x020200 | 131584 | MultiMapGet | MISSING |
| 0x020300 | 131840 | MultiMapRemove | MISSING |
| 0x020400 | 132096 | MultiMapRemoveEntry | MISSING |
| 0x020500 | 132352 | MultiMapKeySet | MISSING |
| 0x020600 | 132608 | MultiMapValues | MISSING |
| 0x020700 | 132864 | MultiMapEntrySet | MISSING |
| 0x020800 | 133120 | MultiMapContainsKey | MISSING |
| 0x020900 | 133376 | MultiMapContainsValue | MISSING |
| 0x020A00 | 133632 | MultiMapContainsEntry | MISSING |
| 0x020B00 | 133888 | MultiMapSize | MISSING |
| 0x020C00 | 134144 | MultiMapClear | MISSING |
| 0x020D00 | 134400 | MultiMapValueCount | MISSING |
| 0x020E00 | 134656 | MultiMapAddEntryListenerToKey | MISSING |
| 0x020F00 | 134912 | MultiMapAddEntryListener | MISSING |
| 0x021000 | 135168 | MultiMapRemoveEntryListener | MISSING |
| 0x021100 | 135424 | MultiMapLock | MISSING |
| 0x021200 | 135680 | MultiMapTryLock | MISSING |
| 0x021300 | 135936 | MultiMapIsLocked | MISSING |
| 0x021400 | 136192 | MultiMapUnlock | MISSING |
| 0x021500 | 136448 | MultiMapForceUnlock | MISSING |
| 0x021600 | 136704 | MultiMapDelete | MISSING |
| 0x021700 | 136960 | MultiMapPutAll | MISSING |

---

## Service 0x03 — Queue

Handler registration: `src/instance/impl/HeliosInstanceImpl.ts`

| Opcode (hex) | Decimal | Method | Codec File | Handler | Status |
|---|---|---|---|---|---|
| 0x030100 | 197120 | QueueOffer | `QueueOfferCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x030200 | 197376 | QueuePoll | `QueuePollCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x030300 | 197632 | QueuePeek | `QueuePeekCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x030400 | 197888 | QueueClear | `QueueClearCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x030500 | 198144 | QueueSize | `QueueSizeCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x030600 | 198400 | QueueIsEmpty | — | — | MISSING |
| 0x030700 | 198656 | QueueAdd | — | — | MISSING |
| 0x030800 | 198912 | QueueRemove | — | — | MISSING |
| 0x030900 | 199168 | QueuePut | — | — | MISSING |
| 0x030A00 | 199424 | QueueTake | — | — | MISSING |
| 0x030B00 | 199680 | QueueContains | — | — | MISSING |
| 0x030C00 | 199936 | QueueContainsAll | — | — | MISSING |
| 0x030D00 | 200192 | QueueDrainTo | — | — | MISSING |
| 0x030E00 | 200448 | QueueAddAll | — | — | MISSING |
| 0x030F00 | 200704 | QueueRemoveAll | — | — | MISSING |
| 0x031000 | 200960 | QueueRetainAll | — | — | MISSING |
| 0x031100 | 201216 | QueueToArray | — | — | MISSING |
| 0x031200 | 201472 | QueueRemainingCapacity | — | — | MISSING |
| 0x031300 | 201728 | QueueAddItemListener | — | — | MISSING |
| 0x031400 | 201984 | QueueRemoveItemListener | — | — | MISSING |
| 0x031500 | 202240 | QueueElement | — | — | MISSING |
| 0x031600 | 202496 | QueueRemoveElement | — | — | MISSING |
| 0x031700 | 202752 | QueueDrainMaxElements | — | — | MISSING |
| 0x031800 | 203008 | QueueCompareAndRemoveAll | — | — | MISSING |
| 0x031900 | 203264 | QueueCompareAndRetainAll | — | — | MISSING |
| 0x031A00 | 203520 | QueueIterator | — | — | MISSING |

---

## Service 0x04 — Topic

Handler registration: `src/instance/impl/HeliosInstanceImpl.ts`

| Opcode (hex) | Decimal | Method | Codec File | Handler | Status |
|---|---|---|---|---|---|
| 0x040100 | 262400 | TopicPublish | `TopicPublishCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x040200 | 262656 | TopicAddMessageListener | `TopicAddMessageListenerCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x040300 | 262912 | TopicRemoveMessageListener | `TopicRemoveMessageListenerCodec.ts` | `HeliosInstanceImpl` | DONE |
| 0x040400 | 263168 | TopicPublishAll | — | — | MISSING |
| 0x040500 | 263424 | TopicGetLocalTopicStats | — | — | MISSING |

---

## Service 0x05 — List

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x050100 | 327936 | ListSize | MISSING |
| 0x050200 | 328192 | ListContains | MISSING |
| 0x050300 | 328448 | ListContainsAll | MISSING |
| 0x050400 | 328704 | ListAdd | MISSING |
| 0x050500 | 328960 | ListRemove | MISSING |
| 0x050600 | 329216 | ListAddAll | MISSING |
| 0x050700 | 329472 | ListCompareAndRemoveAll | MISSING |
| 0x050800 | 329728 | ListCompareAndRetainAll | MISSING |
| 0x050900 | 329984 | ListClear | MISSING |
| 0x050A00 | 330240 | ListGetAll | MISSING |
| 0x050B00 | 330496 | ListAddWithIndex | MISSING |
| 0x050C00 | 330752 | ListRemoveWithIndex | MISSING |
| 0x050D00 | 331008 | ListIndexOf | MISSING |
| 0x050E00 | 331264 | ListLastIndexOf | MISSING |
| 0x050F00 | 331520 | ListGet | MISSING |
| 0x051000 | 331776 | ListSet | MISSING |
| 0x051100 | 332032 | ListSublist | MISSING |
| 0x051200 | 332288 | ListIterator | MISSING |
| 0x051300 | 332544 | ListListIterator | MISSING |
| 0x051400 | 332800 | ListAddAllWithIndex | MISSING |
| 0x051500 | 333056 | ListAddItemListener | MISSING |
| 0x051600 | 333312 | ListRemoveItemListener | MISSING |
| 0x051700 | 333568 | ListIsEmpty | MISSING |

---

## Service 0x06 — Set

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x060100 | 393472 | SetSize | MISSING |
| 0x060200 | 393728 | SetContains | MISSING |
| 0x060300 | 393984 | SetContainsAll | MISSING |
| 0x060400 | 394240 | SetAdd | MISSING |
| 0x060500 | 394496 | SetRemove | MISSING |
| 0x060600 | 394752 | SetAddAll | MISSING |
| 0x060700 | 395008 | SetCompareAndRemoveAll | MISSING |
| 0x060800 | 395264 | SetCompareAndRetainAll | MISSING |
| 0x060900 | 395520 | SetClear | MISSING |
| 0x060A00 | 395776 | SetGetAll | MISSING |
| 0x060B00 | 396032 | SetAddItemListener | MISSING |
| 0x060C00 | 396288 | SetRemoveItemListener | MISSING |
| 0x060D00 | 396544 | SetIsEmpty | MISSING |
| 0x060E00 | 396800 | SetIterator | MISSING |

---

## Service 0x07 — ReplicatedMap

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x070100 | 459008 | ReplicatedMapPut | MISSING |
| 0x070200 | 459264 | ReplicatedMapSize | MISSING |
| 0x070300 | 459520 | ReplicatedMapIsEmpty | MISSING |
| 0x070400 | 459776 | ReplicatedMapContainsKey | MISSING |
| 0x070500 | 460032 | ReplicatedMapContainsValue | MISSING |
| 0x070600 | 460288 | ReplicatedMapGet | MISSING |
| 0x070700 | 460544 | ReplicatedMapRemove | MISSING |
| 0x070800 | 460800 | ReplicatedMapPutAll | MISSING |
| 0x070900 | 461056 | ReplicatedMapClear | MISSING |
| 0x070A00 | 461312 | ReplicatedMapAddEntryListenerToKeyWithPredicate | MISSING |
| 0x070B00 | 461568 | ReplicatedMapAddEntryListenerWithPredicate | MISSING |
| 0x070C00 | 461824 | ReplicatedMapAddEntryListenerToKey | MISSING |
| 0x070D00 | 462080 | ReplicatedMapAddEntryListener | MISSING |
| 0x070E00 | 462336 | ReplicatedMapRemoveEntryListener | MISSING |
| 0x070F00 | 462592 | ReplicatedMapKeySet | MISSING |
| 0x071000 | 462848 | ReplicatedMapValues | MISSING |
| 0x071100 | 463104 | ReplicatedMapEntrySet | MISSING |
| 0x071200 | 463360 | ReplicatedMapAddNearCacheEntryListener | MISSING |
| 0x071300 | 463616 | ReplicatedMapEndEntryListenerToKeyWithPredicate | MISSING |

---

## Service 0x09 — Ringbuffer

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x190100 | 1638656 | RingbufferSize | MISSING |
| 0x190200 | 1638912 | RingbufferTailSequence | MISSING |
| 0x190300 | 1639168 | RingbufferHeadSequence | MISSING |
| 0x190400 | 1639424 | RingbufferCapacity | MISSING |
| 0x190500 | 1639680 | RingbufferRemainingCapacity | MISSING |
| 0x190600 | 1639936 | RingbufferAdd | MISSING |
| 0x190700 | 1640192 | RingbufferReadOne | MISSING |
| 0x190800 | 1640448 | RingbufferAddAll | MISSING |
| 0x190900 | 1640704 | RingbufferReadMany | MISSING |

---

## Service 0x0B — ReliableTopic

| Opcode (hex) | Decimal | Method | Codec File | Status |
|---|---|---|---|---|
| 0x0B0A00 | 723456 | TopicAddMessageListener (reliable) | `TopicAddMessageListenerCodec.ts` | DONE |
| 0x0B0A10 | 723472 | TopicRemoveMessageListener (reliable) | `TopicRemoveMessageListenerCodec.ts` | DONE |
| Note | ReliableTopic uses Ringbuffer opcodes for actual publish/subscribe | — | MISSING (Ringbuffer codecs) |

---

## Service 0x0E — ExecutorService

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x0E0100 | 917760 | ExecutorServiceShutdown | MISSING |
| 0x0E0200 | 918016 | ExecutorServiceIsShutdown | MISSING |
| 0x0E0300 | 918272 | ExecutorServiceCancelOnPartition | MISSING |
| 0x0E0400 | 918528 | ExecutorServiceCancelOnMember | MISSING |
| 0x0E0500 | 918784 | ExecutorServiceSubmitToPartition | MISSING |
| 0x0E0600 | 919040 | ExecutorServiceSubmitToMember | MISSING |

---

## Service 0x15 — Cache (JCache)

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x150100 | 1376512 | CacheAddEntryListener | MISSING |
| 0x150200 | 1376768 | CacheClear | MISSING |
| 0x150300 | 1377024 | CacheContainsKey | MISSING |
| 0x150400 | 1377280 | CacheCreateConfig | MISSING |
| 0x150500 | 1377536 | CacheDestroyConfig | MISSING |
| 0x150600 | 1377792 | CacheEntryProcessor | MISSING |
| 0x150700 | 1378048 | CacheGetAll | MISSING |
| 0x150800 | 1378304 | CacheGetAndRemove | MISSING |
| 0x150900 | 1378560 | CacheGetAndReplace | MISSING |
| 0x150A00 | 1378816 | CacheGetConfig | MISSING |
| 0x150B00 | 1379072 | CacheGet | MISSING |
| 0x150C00 | 1379328 | CacheIterate | MISSING |
| 0x150D00 | 1379584 | CacheListenerRegistration | MISSING |
| 0x150E00 | 1379840 | CacheLoadAll | MISSING |
| 0x150F00 | 1380096 | CacheManagementConfig | MISSING |
| 0x151000 | 1380352 | CachePutIfAbsent | MISSING |
| 0x151100 | 1380608 | CachePut | MISSING |
| 0x151200 | 1380864 | CacheRemoveAll | MISSING |
| 0x151300 | 1381120 | CacheRemoveAllKeys | MISSING |
| 0x151400 | 1381376 | CacheRemove | MISSING |
| 0x151500 | 1381632 | CacheReplace | MISSING |
| 0x151600 | 1381888 | CacheSize | MISSING |
| 0x151700 | 1382144 | CacheAddPartitionLostListener | MISSING |
| 0x151800 | 1382400 | CacheRemovePartitionLostListener | MISSING |
| 0x151900 | 1382656 | CachePutAll | MISSING |
| 0x151A00 | 1382912 | CacheFetchNearCacheInvalidationMetadata | PARTIAL (task exists) |
| 0x151B00 | 1383168 | CacheEventJournalSubscribe | MISSING |
| 0x151C00 | 1383424 | CacheEventJournalRead | MISSING |
| 0x151D00 | 1383680 | CacheSetExpiryPolicy | MISSING |

---

## Service 0x1A — ScheduledExecutor

Handler registration: `src/server/clientprotocol/ScheduledExecutorMessageHandlers.ts`

| Opcode (hex) | Decimal | Method | Codec File | Handler | Status |
|---|---|---|---|---|---|
| 0x1A0100 | 1704192 | ScheduledExecutorShutdown | `ScheduledExecutorShutdownCodec.ts` | `ScheduledExecutorMessageHandlers` | DONE |
| 0x1A0200 | 1704448 | ScheduledExecutorSubmitToPartition | `ScheduledExecutorSubmitToPartitionCodec.ts` | `ScheduledExecutorMessageHandlers` | DONE |
| 0x1A0300 | 1704704 | ScheduledExecutorSubmitToMember | `ScheduledExecutorSubmitToMemberCodec.ts` | `ScheduledExecutorMessageHandlers` | DONE |
| 0x1A0400 | 1704960 | ScheduledExecutorCancel | `ScheduledExecutorCancelCodec.ts` | `ScheduledExecutorMessageHandlers` | DONE |
| 0x1A0500 | 1705216 | ScheduledExecutorDispose | `ScheduledExecutorDisposeCodec.ts` | `ScheduledExecutorMessageHandlers` | DONE |
| 0x1A0600 | 1705472 | ScheduledExecutorGetResult | — | — | MISSING |
| 0x1A0700 | 1705728 | ScheduledExecutorIsShutdown | — | — | MISSING |
| 0x1A0800 | 1705984 | ScheduledExecutorGetAllScheduledFutures | `ScheduledExecutorGetAllScheduledFuturesCodec.ts` | `ScheduledExecutorMessageHandlers` | DONE |
| 0x1A0900 | 1706240 | ScheduledExecutorGetStats | `ScheduledExecutorGetStatsCodec.ts` | `ScheduledExecutorMessageHandlers` | DONE |
| 0x1A0A00 | 1706496 | ScheduledExecutorGetDelay | — | — | MISSING |
| 0x1A0B00 | 1706752 | ScheduledExecutorIsDone | — | — | MISSING |
| 0x1A0C00 | 1707008 | ScheduledExecutorIsCancelled | — | — | MISSING |
| 0x1A0D00 | 1707264 | ScheduledExecutorGetState | `ScheduledExecutorGetStateCodec.ts` | `ScheduledExecutorMessageHandlers` | DONE |
| 0x1A0E00 | 1707520 | ScheduledExecutorSubmitToPartitionAtFixedRate | — | — | MISSING |
| 0x1A0F00 | 1707776 | ScheduledExecutorSubmitToMemberAtFixedRate | — | — | MISSING |
| 0x1A1000 | 1708032 | ScheduledExecutorScheduleOnAllMembers | — | — | MISSING |
| 0x1A1100 | 1708288 | ScheduledExecutorGetAllScheduledFutures (v2) | `ScheduledExecutorGetAllScheduledFuturesCodec.ts` | `ScheduledExecutorMessageHandlers` | DONE |

---

## Service 0x1E — FlakeIdGenerator

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x1E0100 | 1966848 | FlakeIdGeneratorNewIdBatch | MISSING |

---

## Service 0x20 — CardinalityEstimator / PNCounter

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x200100 | 2097408 | CardinalityEstimatorAdd | MISSING |
| 0x200200 | 2097664 | CardinalityEstimatorEstimate | MISSING |
| 0x200300 | 2097920 | PNCounterGet | MISSING |
| 0x200400 | 2098176 | PNCounterAdd | MISSING |
| 0x200500 | 2098432 | PNCounterGetConfiguredReplicaCount | MISSING |

---

## Service 0x21 — SQL

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x210100 | 2162944 | SqlExecute | MISSING |
| 0x210200 | 2163200 | SqlFetch | MISSING |
| 0x210300 | 2163456 | SqlClose | MISSING |
| 0x210400 | 2163712 | SqlMappingDdl | MISSING |

---

## Service 0x16 — Transaction

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x160100 | 1442048 | TransactionCreate | MISSING |
| 0x160200 | 1442304 | TransactionCommit | MISSING |
| 0x160300 | 1442560 | TransactionRollback | MISSING |
| 0x161100 | 1444608 | TransactionalMapPut | MISSING |
| 0x161200 | 1444864 | TransactionalMapGet | MISSING |
| 0x161300 | 1445120 | TransactionalMapContainsKey | MISSING |
| 0x161400 | 1445376 | TransactionalMapSize | MISSING |
| 0x161500 | 1445632 | TransactionalMapPutIfAbsent | MISSING |
| 0x161600 | 1445888 | TransactionalMapReplace | MISSING |
| 0x161700 | 1446144 | TransactionalMapReplaceIfSame | MISSING |
| 0x161800 | 1446400 | TransactionalMapRemove | MISSING |
| 0x161900 | 1446656 | TransactionalMapDelete | MISSING |
| 0x161A00 | 1446912 | TransactionalMapRemoveIfSame | MISSING |
| 0x161B00 | 1447168 | TransactionalMapKeySet | MISSING |
| 0x161C00 | 1447424 | TransactionalMapKeySetWithPredicate | MISSING |
| 0x161D00 | 1447680 | TransactionalMapValues | MISSING |
| 0x161E00 | 1447936 | TransactionalMapValuesWithPredicate | MISSING |
| 0x161F00 | 1448192 | TransactionalQueueOffer | MISSING |
| 0x162000 | 1448448 | TransactionalQueuePoll | MISSING |
| 0x162100 | 1448704 | TransactionalQueuePeek | MISSING |
| 0x162200 | 1448960 | TransactionalQueueSize | MISSING |
| 0x162300 | 1449216 | TransactionalMultiMapPut | MISSING |
| 0x162400 | 1449472 | TransactionalMultiMapGet | MISSING |
| 0x162500 | 1449728 | TransactionalMultiMapRemove | MISSING |
| 0x162600 | 1449984 | TransactionalMultiMapValueCount | MISSING |
| 0x162700 | 1450240 | TransactionalMultiMapSize | MISSING |

---

## Service 0x27+ — CP Subsystem

| Opcode (hex) | Decimal | Method | Status |
|---|---|---|---|
| 0x270100 | 2556672 | CPSubsystemAddMembershipListener | MISSING |
| 0x270200 | 2556928 | CPSubsystemRemoveMembershipListener | MISSING |
| 0x270300 | 2557184 | CPSubsystemAddGroupAvailabilityListener | MISSING |
| 0x270400 | 2557440 | CPSubsystemRemoveGroupAvailabilityListener | MISSING |
| 0x280100 | 2621696 | AtomicLongApply | MISSING |
| 0x280200 | 2621952 | AtomicLongAlter | MISSING |
| 0x280300 | 2622208 | AtomicLongAddAndGet | MISSING |
| 0x280400 | 2622464 | AtomicLongCompareAndSet | MISSING |
| 0x280500 | 2622720 | AtomicLongGet | MISSING |
| 0x280600 | 2622976 | AtomicLongGetAndAdd | MISSING |
| 0x280700 | 2623232 | AtomicLongGetAndSet | MISSING |
| 0x280800 | 2623488 | AtomicLongSet | MISSING |
| 0x290100 | 2687232 | AtomicRefApply | MISSING |
| 0x290200 | 2687488 | AtomicRefCompareAndSet | MISSING |
| 0x290300 | 2687744 | AtomicRefContains | MISSING |
| 0x290400 | 2687744 | AtomicRefGet | MISSING |
| 0x290500 | 2688256 | AtomicRefSet | MISSING |
| 0x2A0100 | 2752768 | CountDownLatchAwait | MISSING |
| 0x2A0200 | 2753024 | CountDownLatchCountDown | MISSING |
| 0x2A0300 | 2753280 | CountDownLatchGetCount | MISSING |
| 0x2A0400 | 2753536 | CountDownLatchGetRound | MISSING |
| 0x2A0500 | 2753792 | CountDownLatchTrySetCount | MISSING |
| 0x2B0100 | 2818304 | SemaphoreAcquire | MISSING |
| 0x2B0200 | 2818560 | SemaphoreAvailablePermits | MISSING |
| 0x2B0300 | 2818816 | SemaphoreDrain | MISSING |
| 0x2B0400 | 2819072 | SemaphoreInit | MISSING |
| 0x2B0500 | 2819328 | SemaphoreRelease | MISSING |
| 0x2B0600 | 2819584 | SemaphoreTryAcquire | MISSING |
| 0x2C0100 | 2883840 | FencedLockLock | MISSING |
| 0x2C0200 | 2884096 | FencedLockTryLock | MISSING |
| 0x2C0300 | 2884352 | FencedLockUnlock | MISSING |
| 0x2C0400 | 2884608 | FencedLockGetLockOwnership | MISSING |
| 0x2D0100 | 2949376 | CPMapGet | MISSING |
| 0x2D0200 | 2949632 | CPMapPut | MISSING |
| 0x2D0300 | 2949888 | CPMapRemove | MISSING |
| 0x2D0400 | 2950144 | CPMapCompareAndSet | MISSING |
| 0x2D0500 | 2950400 | CPMapPutIfAbsent | MISSING |

---

## Summary

| Service | Total Opcodes | Codecs Implemented | Handlers Wired | Coverage |
|---|---|---|---|---|
| Client (0x00) | 19 | 4 | 1 | 5% |
| Map (0x01) | 60 | 9 | 8 | 13% |
| MultiMap (0x02) | 23 | 0 | 0 | 0% |
| Queue (0x03) | 26 | 5 | 5 | 19% |
| Topic (0x04) | 5 | 3 | 3 | 60% |
| List (0x05) | 23 | 0 | 0 | 0% |
| Set (0x06) | 14 | 0 | 0 | 0% |
| ReplicatedMap (0x07) | 19 | 0 | 0 | 0% |
| Ringbuffer (0x19) | 9 | 0 | 0 | 0% |
| ReliableTopic (0x0B) | 2+Ringbuffer | 2 | 2 | — |
| ExecutorService (0x0E) | 6 | 0 | 0 | 0% |
| Cache/JCache (0x15) | 29 | 0 | 0 | 0% |
| ScheduledExecutor (0x1A) | 17 | 9 | 8 | 47% |
| FlakeIdGenerator (0x1E) | 1 | 0 | 0 | 0% |
| CardinalityEstimator/PNCounter (0x20) | 5 | 0 | 0 | 0% |
| SQL (0x21) | 4 | 0 | 0 | 0% |
| Transaction (0x16) | 27 | 0 | 0 | 0% |
| CP Subsystem (0x27+) | 37 | 0 | 0 | 0% |
| **TOTAL** | **~325** | **~32** | **~27** | **~10%** |
