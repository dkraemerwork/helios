import { describe, it, expect } from 'bun:test';
import { ClientMessage } from '@zenystx/core/client/impl/protocol/ClientMessage';
import { EntryListIntegerUUIDCodec } from '@zenystx/core/client/impl/protocol/codec/builtin/EntryListIntegerUUIDCodec';

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const UUID_B = '00000000-0000-0000-0000-000000000001';

function roundTrip(entries: Array<[number, string | null]>): Array<[number, string | null]> {
    const msg = ClientMessage.createForEncode();
    EntryListIntegerUUIDCodec.encode(msg, entries);
    const iter = msg.forwardFrameIterator();
    return EntryListIntegerUUIDCodec.decode(iter);
}

describe('EntryListIntegerUUIDCodec', () => {
    it('encodes and decodes empty list', () => {
        expect(roundTrip([])).toEqual([]);
    });

    it('encodes and decodes a single entry', () => {
        expect(roundTrip([[0, UUID_A]])).toEqual([[0, UUID_A]]);
    });

    it('encodes and decodes multiple entries', () => {
        const entries: Array<[number, string | null]> = [[1, UUID_A], [271, UUID_B]];
        expect(roundTrip(entries)).toEqual(entries);
    });

    it('handles null UUID values', () => {
        const entries: Array<[number, string | null]> = [[3, null]];
        expect(roundTrip(entries)).toEqual(entries);
    });

    it('handles mixed null and non-null UUIDs', () => {
        const entries: Array<[number, string | null]> = [[1, UUID_A], [2, null], [3, UUID_B]];
        const result = roundTrip(entries);
        expect(result[0]).toEqual([1, UUID_A]);
        expect(result[1]).toEqual([2, null]);
        expect(result[2]).toEqual([3, UUID_B]);
    });
});
