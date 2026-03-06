import { describe, it, expect } from 'bun:test';
import { ClientMessage } from '@zenystx/core/client/impl/protocol/ClientMessage';
import { EntryListIntegerLongCodec } from '@zenystx/core/client/impl/protocol/codec/builtin/EntryListIntegerLongCodec';

function roundTrip(entries: Array<[number, bigint]>): Array<[number, bigint]> {
    const msg = ClientMessage.createForEncode();
    EntryListIntegerLongCodec.encode(msg, entries);
    const iter = msg.forwardFrameIterator();
    return EntryListIntegerLongCodec.decode(iter);
}

describe('EntryListIntegerLongCodec', () => {
    it('encodes and decodes empty list', () => {
        expect(roundTrip([])).toEqual([]);
    });

    it('encodes and decodes a single entry', () => {
        expect(roundTrip([[1, 100n]])).toEqual([[1, 100n]]);
    });

    it('encodes and decodes multiple entries', () => {
        const entries: Array<[number, bigint]> = [[0, 0n], [1, 999n], [271, -1n]];
        expect(roundTrip(entries)).toEqual(entries);
    });

    it('preserves negative integer keys', () => {
        const entries: Array<[number, bigint]> = [[-1, 42n]];
        expect(roundTrip(entries)).toEqual(entries);
    });

    it('preserves max/min long values', () => {
        const max = BigInt('9223372036854775807');
        const min = BigInt('-9223372036854775808');
        expect(roundTrip([[5, max]])).toEqual([[5, max]]);
        expect(roundTrip([[6, min]])).toEqual([[6, min]]);
    });
});
