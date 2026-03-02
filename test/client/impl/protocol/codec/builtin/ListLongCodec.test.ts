import { describe, it, expect } from 'bun:test';
import { ClientMessage } from '@helios/client/impl/protocol/ClientMessage';
import { ListLongCodec } from '@helios/client/impl/protocol/codec/builtin/ListLongCodec';

function roundTrip(values: bigint[]): bigint[] {
    const msg = ClientMessage.createForEncode();
    ListLongCodec.encode(msg, values);
    const iter = msg.forwardFrameIterator();
    return ListLongCodec.decode(iter);
}

describe('ListLongCodec', () => {
    it('encodes and decodes an empty list', () => {
        expect(roundTrip([])).toEqual([]);
    });

    it('encodes and decodes a single element', () => {
        expect(roundTrip([42n])).toEqual([42n]);
    });

    it('encodes and decodes multiple elements', () => {
        const values = [0n, 1n, 100n, -1n, 9999999999999n];
        expect(roundTrip(values)).toEqual(values);
    });

    it('encodes and decodes large bigint values', () => {
        const values = [BigInt('9223372036854775807'), BigInt('-9223372036854775808')];
        expect(roundTrip(values)).toEqual(values);
    });

    it('decodeFrame works on a single frame', () => {
        const msg = ClientMessage.createForEncode();
        ListLongCodec.encode(msg, [10n, 20n, 30n]);
        const iter = msg.forwardFrameIterator();
        const frame = iter.next();
        const result = ListLongCodec.decodeFrame(frame);
        expect(result).toEqual([10n, 20n, 30n]);
    });
});
