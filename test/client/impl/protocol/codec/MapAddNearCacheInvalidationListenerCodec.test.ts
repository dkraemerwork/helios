import { describe, it, expect } from 'bun:test';
import { MapAddNearCacheInvalidationListenerCodec } from '@zenystx/core/client/impl/protocol/codec/MapAddNearCacheInvalidationListenerCodec';
import { HeapData } from '@zenystx/core/internal/serialization/impl/HeapData';
import type { Data } from '@zenystx/core/internal/serialization/Data';

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_B = '11111111-2222-3333-4444-555555555555';
const UUID_C = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

describe('MapAddNearCacheInvalidationListenerCodec', () => {
    describe('message type constants', () => {
        it('REQUEST_MESSAGE_TYPE is 0x013F00', () => {
            expect(MapAddNearCacheInvalidationListenerCodec.REQUEST_MESSAGE_TYPE).toBe(0x013F00);
        });
        it('RESPONSE_MESSAGE_TYPE is 0x013F01', () => {
            expect(MapAddNearCacheInvalidationListenerCodec.RESPONSE_MESSAGE_TYPE).toBe(0x013F01);
        });
        it('EVENT_I_MAP_INVALIDATION_MESSAGE_TYPE is 0x013F02', () => {
            expect(MapAddNearCacheInvalidationListenerCodec.EVENT_I_MAP_INVALIDATION_MESSAGE_TYPE).toBe(0x013F02);
        });
        it('EVENT_I_MAP_BATCH_INVALIDATION_MESSAGE_TYPE is 0x013F03', () => {
            expect(MapAddNearCacheInvalidationListenerCodec.EVENT_I_MAP_BATCH_INVALIDATION_MESSAGE_TYPE).toBe(0x013F03);
        });
    });

    describe('request encode/decode', () => {
        it('round-trips name, listenerFlags, localOnly', () => {
            const msg = MapAddNearCacheInvalidationListenerCodec.encodeRequest('myMap', 7, true);
            const params = MapAddNearCacheInvalidationListenerCodec.decodeRequest(msg);
            expect(params.name).toBe('myMap');
            expect(params.listenerFlags).toBe(7);
            expect(params.localOnly).toBe(true);
        });

        it('round-trips localOnly=false', () => {
            const msg = MapAddNearCacheInvalidationListenerCodec.encodeRequest('testMap', 0, false);
            const params = MapAddNearCacheInvalidationListenerCodec.decodeRequest(msg);
            expect(params.localOnly).toBe(false);
        });
    });

    describe('response encode/decode', () => {
        it('round-trips registration UUID', () => {
            const msg = MapAddNearCacheInvalidationListenerCodec.encodeResponse(UUID_A);
            const decoded = MapAddNearCacheInvalidationListenerCodec.decodeResponse(msg);
            expect(decoded).toBe(UUID_A);
        });
    });

    describe('IMapInvalidationEvent encode/decode', () => {
        it('AbstractEventHandler dispatches single invalidation event', () => {
            const key = new HeapData(Buffer.alloc(8));
            const msg = MapAddNearCacheInvalidationListenerCodec.encodeIMapInvalidationEvent(key, UUID_A, UUID_B, 42n);

            const captured: { sourceUuid: string | null; partitionUuid: string | null; sequence: bigint } = {
                sourceUuid: null, partitionUuid: null, sequence: 0n,
            };

            const handler = new (class extends MapAddNearCacheInvalidationListenerCodec.AbstractEventHandler {
                handleIMapInvalidationEvent(_k: Data | null, su: string | null, pu: string | null, seq: bigint): void {
                    captured.sourceUuid = su;
                    captured.partitionUuid = pu;
                    captured.sequence = seq;
                }
                handleIMapBatchInvalidationEvent(): void {}
            })();
            handler.handle(msg);

            expect(captured.sourceUuid).toBe(UUID_A);
            expect(captured.partitionUuid).toBe(UUID_B);
            expect(captured.sequence).toBe(42n);
        });

        it('AbstractEventHandler dispatches batch invalidation event', () => {
            const keys = [new HeapData(Buffer.alloc(8)), new HeapData(Buffer.alloc(8))];
            const sourceUuids = [UUID_A, UUID_A];
            const partitionUuids = [UUID_B, UUID_C];
            const sequences = [1n, 2n];
            const msg = MapAddNearCacheInvalidationListenerCodec.encodeIMapBatchInvalidationEvent(
                keys, sourceUuids, partitionUuids, sequences
            );

            const captured: {
                keys: Data[] | null;
                sourceUuids: (string | null)[] | null;
                partitionUuids: (string | null)[] | null;
                sequences: bigint[] | null;
            } = { keys: null, sourceUuids: null, partitionUuids: null, sequences: null };

            const handler = new (class extends MapAddNearCacheInvalidationListenerCodec.AbstractEventHandler {
                handleIMapInvalidationEvent(): void {}
                handleIMapBatchInvalidationEvent(
                    ks: Data[], sus: (string | null)[], pus: (string | null)[], seqs: bigint[]
                ): void {
                    captured.keys = ks;
                    captured.sourceUuids = sus;
                    captured.partitionUuids = pus;
                    captured.sequences = seqs;
                }
            })();
            handler.handle(msg);

            expect(captured.keys).not.toBeNull();
            expect(captured.sourceUuids).toEqual([UUID_A, UUID_A]);
            expect(captured.partitionUuids).toEqual([UUID_B, UUID_C]);
            expect(captured.sequences).toEqual([1n, 2n]);
        });
    });
});
