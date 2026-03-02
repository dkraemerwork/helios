import { describe, it, expect } from 'bun:test';
import { ClientMessage } from '@helios/client/impl/protocol/ClientMessage';
import { EntryListCodec } from '@helios/client/impl/protocol/codec/builtin/EntryListCodec';
import { StringCodec } from '@helios/client/impl/protocol/codec/builtin/StringCodec';
import { ListLongCodec } from '@helios/client/impl/protocol/codec/builtin/ListLongCodec';

function roundTripStringBigint(entries: Array<[string, bigint[]]>): Array<[string, bigint[]]> {
    const msg = ClientMessage.createForEncode();
    EntryListCodec.encode(
        msg,
        entries,
        (m, k) => StringCodec.encode(m, k),
        (m, v) => ListLongCodec.encode(m, v)
    );
    const iter = msg.forwardFrameIterator();
    return EntryListCodec.decode(
        iter,
        i => StringCodec.decode(i),
        i => ListLongCodec.decode(i)
    );
}

describe('EntryListCodec', () => {
    it('encodes and decodes empty list', () => {
        expect(roundTripStringBigint([])).toEqual([]);
    });

    it('encodes and decodes single entry', () => {
        const entries: Array<[string, bigint[]]> = [['myMap', [1n, 2n, 3n]]];
        expect(roundTripStringBigint(entries)).toEqual(entries);
    });

    it('encodes and decodes multiple entries', () => {
        const entries: Array<[string, bigint[]]> = [
            ['map1', [100n, 200n]],
            ['map2', [999n]],
            ['map3', []],
        ];
        expect(roundTripStringBigint(entries)).toEqual(entries);
    });

    it('produces proper BEGIN/END frame structure', () => {
        const msg = ClientMessage.createForEncode();
        EntryListCodec.encode(
            msg,
            [['a', 1n]],
            (m, k) => StringCodec.encode(m, k),
            (m, v) => {
                const buf = Buffer.allocUnsafe(8);
                buf.writeBigInt64LE(v, 0);
                m.add(new ClientMessage.Frame(buf));
            }
        );
        const iter = msg.forwardFrameIterator();
        const beginFrame = iter.next();
        expect(beginFrame.isBeginFrame()).toBe(true);
    });

    it('decodes to array of tuples (not Map)', () => {
        const entries: Array<[string, bigint[]]> = [['x', [7n]], ['y', [8n]]];
        const result = roundTripStringBigint(entries);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(2);
        expect(result[0][0]).toBe('x');
        expect(result[1][0]).toBe('y');
    });
});
