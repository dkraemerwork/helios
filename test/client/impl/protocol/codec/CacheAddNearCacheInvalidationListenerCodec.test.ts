import { describe, it, expect } from 'bun:test';
import { CacheAddNearCacheInvalidationListenerCodec } from '@helios/client/impl/protocol/codec/CacheAddNearCacheInvalidationListenerCodec';
import { HeapData } from '@helios/internal/serialization/impl/HeapData';
import type { Data } from '@helios/internal/serialization/Data';

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_B = '11111111-2222-3333-4444-555555555555';

describe('CacheAddNearCacheInvalidationListenerCodec', () => {
    describe('message type constants', () => {
        it('REQUEST_MESSAGE_TYPE is 0x131D00', () => {
            expect(CacheAddNearCacheInvalidationListenerCodec.REQUEST_MESSAGE_TYPE).toBe(0x131D00);
        });
        it('RESPONSE_MESSAGE_TYPE is 0x131D01', () => {
            expect(CacheAddNearCacheInvalidationListenerCodec.RESPONSE_MESSAGE_TYPE).toBe(0x131D01);
        });
        it('EVENT_CACHE_INVALIDATION_MESSAGE_TYPE is 0x131D02', () => {
            expect(CacheAddNearCacheInvalidationListenerCodec.EVENT_CACHE_INVALIDATION_MESSAGE_TYPE).toBe(0x131D02);
        });
        it('EVENT_CACHE_BATCH_INVALIDATION_MESSAGE_TYPE is 0x131D03', () => {
            expect(CacheAddNearCacheInvalidationListenerCodec.EVENT_CACHE_BATCH_INVALIDATION_MESSAGE_TYPE).toBe(0x131D03);
        });
    });

    describe('request encode/decode', () => {
        it('round-trips name and localOnly=true', () => {
            const msg = CacheAddNearCacheInvalidationListenerCodec.encodeRequest('myCache', true);
            const params = CacheAddNearCacheInvalidationListenerCodec.decodeRequest(msg);
            expect(params.name).toBe('myCache');
            expect(params.localOnly).toBe(true);
        });

        it('round-trips localOnly=false', () => {
            const msg = CacheAddNearCacheInvalidationListenerCodec.encodeRequest('otherCache', false);
            const params = CacheAddNearCacheInvalidationListenerCodec.decodeRequest(msg);
            expect(params.localOnly).toBe(false);
        });
    });

    describe('response encode/decode', () => {
        it('round-trips registration UUID', () => {
            const msg = CacheAddNearCacheInvalidationListenerCodec.encodeResponse(UUID_A);
            const decoded = CacheAddNearCacheInvalidationListenerCodec.decodeResponse(msg);
            expect(decoded).toBe(UUID_A);
        });
    });

    describe('CacheInvalidationEvent encode/dispatch', () => {
        it('AbstractEventHandler dispatches single invalidation event', () => {
            const key = new HeapData(Buffer.alloc(8));
            const msg = CacheAddNearCacheInvalidationListenerCodec.encodeCacheInvalidationEvent(
                'myCache', key, UUID_A, UUID_B, 7n
            );

            const captured: {
                name: string | null;
                sourceUuid: string | null;
                partitionUuid: string | null;
                sequence: bigint;
            } = { name: null, sourceUuid: null, partitionUuid: null, sequence: 0n };

            const handler = new (class extends CacheAddNearCacheInvalidationListenerCodec.AbstractEventHandler {
                handleCacheInvalidationEvent(
                    name: string, _key: Data | null, su: string | null, pu: string | null, seq: bigint
                ): void {
                    captured.name = name;
                    captured.sourceUuid = su;
                    captured.partitionUuid = pu;
                    captured.sequence = seq;
                }
                handleCacheBatchInvalidationEvent(): void {}
            })();
            handler.handle(msg);

            expect(captured.name).toBe('myCache');
            expect(captured.sourceUuid).toBe(UUID_A);
            expect(captured.partitionUuid).toBe(UUID_B);
            expect(captured.sequence).toBe(7n);
        });

        it('AbstractEventHandler dispatches batch invalidation event', () => {
            const keys = [new HeapData(Buffer.alloc(8))];
            const msg = CacheAddNearCacheInvalidationListenerCodec.encodeCacheBatchInvalidationEvent(
                'batchCache', keys, [UUID_A], [UUID_B], [99n]
            );

            const captured: { name: string | null; sequences: bigint[] | null } = {
                name: null, sequences: null,
            };

            const handler = new (class extends CacheAddNearCacheInvalidationListenerCodec.AbstractEventHandler {
                handleCacheInvalidationEvent(): void {}
                handleCacheBatchInvalidationEvent(
                    name: string, _ks: Data[], _sus: (string | null)[], _pus: (string | null)[], seqs: bigint[]
                ): void {
                    captured.name = name;
                    captured.sequences = seqs;
                }
            })();
            handler.handle(msg);

            expect(captured.name).toBe('batchCache');
            expect(captured.sequences).toEqual([99n]);
        });
    });
});
