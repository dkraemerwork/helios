import { describe, it, expect } from 'bun:test';
import { MapFetchNearCacheInvalidationMetadataCodec } from '@helios/client/impl/protocol/codec/MapFetchNearCacheInvalidationMetadataCodec';

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_B = '11111111-2222-3333-4444-555555555555';

describe('MapFetchNearCacheInvalidationMetadataCodec', () => {
    describe('message type constants', () => {
        it('REQUEST_MESSAGE_TYPE is 0x013D00', () => {
            expect(MapFetchNearCacheInvalidationMetadataCodec.REQUEST_MESSAGE_TYPE).toBe(0x013D00);
        });
        it('RESPONSE_MESSAGE_TYPE is 0x013D01', () => {
            expect(MapFetchNearCacheInvalidationMetadataCodec.RESPONSE_MESSAGE_TYPE).toBe(0x013D01);
        });
    });

    describe('request encode/decode', () => {
        it('round-trips names list and uuid', () => {
            const names = ['map1', 'map2', 'map3'];
            const msg = MapFetchNearCacheInvalidationMetadataCodec.encodeRequest(names, UUID_A);
            const params = MapFetchNearCacheInvalidationMetadataCodec.decodeRequest(msg);
            expect(params.names).toEqual(names);
            expect(params.uuid).toBe(UUID_A);
        });

        it('round-trips empty names list', () => {
            const msg = MapFetchNearCacheInvalidationMetadataCodec.encodeRequest([], UUID_B);
            const params = MapFetchNearCacheInvalidationMetadataCodec.decodeRequest(msg);
            expect(params.names).toEqual([]);
            expect(params.uuid).toBe(UUID_B);
        });

        it('round-trips single name', () => {
            const msg = MapFetchNearCacheInvalidationMetadataCodec.encodeRequest(['only'], UUID_A);
            const params = MapFetchNearCacheInvalidationMetadataCodec.decodeRequest(msg);
            expect(params.names).toEqual(['only']);
        });
    });

    describe('response encode/decode', () => {
        it('round-trips namePartitionSequenceList and partitionUuidList', () => {
            const namePartitionSequenceList: Array<[string, Array<[number, bigint]>]> = [
                ['map1', [[0, 10n], [1, 20n]]],
                ['map2', [[5, 999n]]],
            ];
            const partitionUuidList: Array<[number, string | null]> = [
                [0, UUID_A],
                [1, UUID_B],
                [5, null],
            ];
            const msg = MapFetchNearCacheInvalidationMetadataCodec.encodeResponse(
                namePartitionSequenceList,
                partitionUuidList
            );
            const resp = MapFetchNearCacheInvalidationMetadataCodec.decodeResponse(msg);
            expect(resp.namePartitionSequenceList).toEqual(namePartitionSequenceList);
            expect(resp.partitionUuidList).toEqual(partitionUuidList);
        });

        it('round-trips empty response', () => {
            const msg = MapFetchNearCacheInvalidationMetadataCodec.encodeResponse([], []);
            const resp = MapFetchNearCacheInvalidationMetadataCodec.decodeResponse(msg);
            expect(resp.namePartitionSequenceList).toEqual([]);
            expect(resp.partitionUuidList).toEqual([]);
        });
    });
});
