import { describe, it, expect } from 'bun:test';
import { CacheFetchNearCacheInvalidationMetadataCodec } from '@zenystx/core/client/impl/protocol/codec/CacheFetchNearCacheInvalidationMetadataCodec';

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_B = '11111111-2222-3333-4444-555555555555';

describe('CacheFetchNearCacheInvalidationMetadataCodec', () => {
    describe('message type constants', () => {
        it('REQUEST_MESSAGE_TYPE is 0x131E00', () => {
            expect(CacheFetchNearCacheInvalidationMetadataCodec.REQUEST_MESSAGE_TYPE).toBe(0x131E00);
        });
        it('RESPONSE_MESSAGE_TYPE is 0x131E01', () => {
            expect(CacheFetchNearCacheInvalidationMetadataCodec.RESPONSE_MESSAGE_TYPE).toBe(0x131E01);
        });
    });

    describe('request encode/decode', () => {
        it('round-trips cache names and uuid', () => {
            const names = ['cache1', 'cache2'];
            const msg = CacheFetchNearCacheInvalidationMetadataCodec.encodeRequest(names, UUID_A);
            const params = CacheFetchNearCacheInvalidationMetadataCodec.decodeRequest(msg);
            expect(params.names).toEqual(names);
            expect(params.uuid).toBe(UUID_A);
        });

        it('round-trips empty names list', () => {
            const msg = CacheFetchNearCacheInvalidationMetadataCodec.encodeRequest([], UUID_B);
            const params = CacheFetchNearCacheInvalidationMetadataCodec.decodeRequest(msg);
            expect(params.names).toEqual([]);
            expect(params.uuid).toBe(UUID_B);
        });

        it('round-trips single cache name', () => {
            const msg = CacheFetchNearCacheInvalidationMetadataCodec.encodeRequest(['onlyCache'], UUID_A);
            const params = CacheFetchNearCacheInvalidationMetadataCodec.decodeRequest(msg);
            expect(params.names).toEqual(['onlyCache']);
        });
    });

    describe('response encode/decode', () => {
        it('round-trips namePartitionSequenceList and partitionUuidList', () => {
            const namePartitionSequenceList: Array<[string, Array<[number, bigint]>]> = [
                ['cache1', [[0, 55n], [2, 77n]]],
            ];
            const partitionUuidList: Array<[number, string | null]> = [
                [0, UUID_A],
                [2, UUID_B],
            ];
            const msg = CacheFetchNearCacheInvalidationMetadataCodec.encodeResponse(
                namePartitionSequenceList,
                partitionUuidList
            );
            const resp = CacheFetchNearCacheInvalidationMetadataCodec.decodeResponse(msg);
            expect(resp.namePartitionSequenceList).toEqual(namePartitionSequenceList);
            expect(resp.partitionUuidList).toEqual(partitionUuidList);
        });

        it('round-trips empty response', () => {
            const msg = CacheFetchNearCacheInvalidationMetadataCodec.encodeResponse([], []);
            const resp = CacheFetchNearCacheInvalidationMetadataCodec.decodeResponse(msg);
            expect(resp.namePartitionSequenceList).toEqual([]);
            expect(resp.partitionUuidList).toEqual([]);
        });
    });
});
