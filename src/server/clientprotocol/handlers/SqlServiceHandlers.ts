/**
 * Block C — SQL Service Protocol Handlers
 *
 * Registers handlers for all SQL opcodes required by hazelcast-client@5.6.x:
 *
 *   Sql.Execute  (0x210100) — execute a SQL statement
 *   Sql.Fetch    (0x210200) — fetch next page of results
 *   Sql.Close    (0x210300) — close a cursor
 *   Sql.MappingDdl (0x210400) — (optional) execute DDL for SQL mappings
 */

import type { ClientMessage } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '@zenystx/helios-core/client/impl/protocol/ClientMessage.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { SqlServiceOperations, SqlExecuteResult, SqlFetchResult, SqlPage, SqlColumnMetadata, SqlError } from './ServiceOperations.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, BOOLEAN_SIZE_IN_BYTES } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import { CodecUtil } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/CodecUtil.js';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';

// ── Message type constants ─────────────────────────────────────────────────────

const SQL_EXECUTE_REQUEST  = 0x210100; const SQL_EXECUTE_RESPONSE  = 0x210101;
const SQL_FETCH_REQUEST    = 0x210200; const SQL_FETCH_RESPONSE    = 0x210201;
const SQL_CLOSE_REQUEST    = 0x210300; const SQL_CLOSE_RESPONSE    = 0x210301;
const SQL_MAPPING_DDL_REQUEST = 0x210400; const SQL_MAPPING_DDL_RESPONSE = 0x210401;

const RH = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;

/** SQL QueryId wire layout: 4 longs (localHigh, localLow, globalHigh, globalLow) */
const QUERY_ID_SIZE = 4 * LONG_SIZE_IN_BYTES; // 32 bytes

// ── Registration ──────────────────────────────────────────────────────────────

export function registerSqlServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: SqlServiceOperations,
): void {
    // Sql.Execute
    dispatcher.register(SQL_EXECUTE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();

        // Initial frame fixed fields:
        // [16..23] timeout (long)
        // [24..27] cursorBufferSize (int)
        // [28..31] partitionArgumentIndex (int)
        // [32..63] queryId (4 longs)
        // [64]     returnRawResult (bool)
        // [65]     expectedResultType (byte)
        const timeout = f.content.readBigInt64LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const cursorBufferSize = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES);
        const partitionArgumentIndex = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const qidOffset = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;
        const localHigh  = f.content.readBigInt64LE(qidOffset);
        const localLow   = f.content.readBigInt64LE(qidOffset + LONG_SIZE_IN_BYTES);
        const globalHigh = f.content.readBigInt64LE(qidOffset + LONG_SIZE_IN_BYTES * 2);
        const globalLow  = f.content.readBigInt64LE(qidOffset + LONG_SIZE_IN_BYTES * 3);

        const returnRawResultOffset = qidOffset + QUERY_ID_SIZE;
        const returnRawResult = f.content.length > returnRawResultOffset
            ? f.content.readUInt8(returnRawResultOffset) !== 0
            : false;
        const expectedResultType = f.content.length > returnRawResultOffset + BOOLEAN_SIZE_IN_BYTES
            ? f.content.readUInt8(returnRawResultOffset + BOOLEAN_SIZE_IN_BYTES)
            : 2; // ANY

        const sql = StringCodec.decode(iter);
        const params = _decodeDataList(iter);
        const schema = CodecUtil.decodeNullable(iter, i => StringCodec.decode(i));

        const queryId = { localHigh, localLow, globalHigh, globalLow };
        const result = await operations.execute(
            sql, params, timeout, cursorBufferSize, partitionArgumentIndex,
            queryId, returnRawResult, schema, expectedResultType,
        );

        return _encodeSqlExecuteResponse(result);
    });

    // Sql.Fetch
    dispatcher.register(SQL_FETCH_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const cursorBufferSize = f.content.readInt32LE(INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        const qidOffset = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;
        const localHigh  = f.content.readBigInt64LE(qidOffset);
        const localLow   = f.content.readBigInt64LE(qidOffset + LONG_SIZE_IN_BYTES);
        const globalHigh = f.content.readBigInt64LE(qidOffset + LONG_SIZE_IN_BYTES * 2);
        const globalLow  = f.content.readBigInt64LE(qidOffset + LONG_SIZE_IN_BYTES * 3);

        const queryId = { localHigh, localLow, globalHigh, globalLow };
        const result = await operations.fetch(queryId, cursorBufferSize);

        return _encodeSqlFetchResponse(result);
    });

    // Sql.Close
    dispatcher.register(SQL_CLOSE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const qidOffset = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES;
        const localHigh  = f.content.readBigInt64LE(qidOffset);
        const localLow   = f.content.readBigInt64LE(qidOffset + LONG_SIZE_IN_BYTES);
        const globalHigh = f.content.readBigInt64LE(qidOffset + LONG_SIZE_IN_BYTES * 2);
        const globalLow  = f.content.readBigInt64LE(qidOffset + LONG_SIZE_IN_BYTES * 3);

        await operations.close({ localHigh, localLow, globalHigh, globalLow });
        return _empty(SQL_CLOSE_RESPONSE);
    });

    // Sql.MappingDdl — forward to execute
    dispatcher.register(SQL_MAPPING_DDL_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator(); iter.next();
        const sql = StringCodec.decode(iter);
        await operations.execute(sql, [], BigInt(-1), 0, -1, {
            localHigh: 0n, localLow: 0n, globalHigh: 0n, globalLow: 0n,
        }, false, null, 2);
        return _empty(SQL_MAPPING_DDL_RESPONSE);
    });
}

// ── Response encoders ─────────────────────────────────────────────────────────

function _encodeSqlExecuteResponse(result: SqlExecuteResult): ClientMessage {
    const msg = CM.createForEncode();

    // Initial frame: updateCount(long) + partitionArgumentIndex(int) + isInfiniteRows(bool)
    const fixedSize = RH + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES;
    const b = Buffer.allocUnsafe(fixedSize);
    b.fill(0);
    b.writeUInt32LE(SQL_EXECUTE_RESPONSE >>> 0, 0);
    b.writeBigInt64LE(result.updateCount, RH);
    b.writeInt32LE(result.partitionArgumentIndex | 0, RH + LONG_SIZE_IN_BYTES);
    b.writeUInt8(result.isInfiniteRows ? 1 : 0, RH + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));

    // Row metadata (nullable)
    if (result.rowMetadata !== null) {
        _encodeColumnMetadataList(msg, result.rowMetadata);
    } else {
        msg.add(CM.NULL_FRAME);
    }

    // Row page (nullable)
    if (result.rowPage !== null) {
        _encodeSqlPage(msg, result.rowPage);
    } else {
        msg.add(CM.NULL_FRAME);
    }

    // Error (nullable)
    if (result.error !== null) {
        _encodeSqlError(msg, result.error);
    } else {
        msg.add(CM.NULL_FRAME);
    }

    msg.setFinal();
    return msg;
}

function _encodeSqlFetchResponse(result: SqlFetchResult): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(SQL_FETCH_RESPONSE >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));

    // Row page (nullable)
    if (result.rowPage !== null) {
        _encodeSqlPage(msg, result.rowPage);
    } else {
        msg.add(CM.NULL_FRAME);
    }

    // Error (nullable)
    if (result.error !== null) {
        _encodeSqlError(msg, result.error);
    } else {
        msg.add(CM.NULL_FRAME);
    }

    msg.setFinal();
    return msg;
}

function _encodeColumnMetadataList(msg: typeof CM.prototype, columns: SqlColumnMetadata[]): void {
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    for (const col of columns) {
        // Each column: name(string), type(int), nullable(bool), nullableIsSet(bool)
        const b = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES);
        b.writeInt32LE(col.type | 0, 0);
        b.writeUInt8(col.nullable ? 1 : 0, INT_SIZE_IN_BYTES);
        b.writeUInt8(col.nullableIsSet ? 1 : 0, INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES);
        msg.add(new CM.Frame(b, CM.BEGIN_DATA_STRUCTURE_FLAG));
        StringCodec.encode(msg, col.name);
        msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
}

function _encodeSqlPage(msg: typeof CM.prototype, page: SqlPage): void {
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    // isLast bool + columnTypes array header
    const headerBuf = Buffer.allocUnsafe(BOOLEAN_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
    headerBuf.writeUInt8(page.last ? 1 : 0, 0);
    headerBuf.writeInt32LE(page.columnTypes.length | 0, BOOLEAN_SIZE_IN_BYTES);
    msg.add(new CM.Frame(headerBuf));
    // Column type bytes (one per column)
    for (const colType of page.columnTypes) {
        const typeBuf = Buffer.allocUnsafe(1);
        typeBuf.writeUInt8(colType & 0xff, 0);
        msg.add(new CM.Frame(typeBuf));
    }
    // Columns: each is a list of Data
    for (const column of page.columns) {
        msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
        for (const item of column) {
            DataCodec.encode(msg, item);
        }
        msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
    }
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
}

function _encodeSqlError(msg: typeof CM.prototype, error: SqlError): void {
    msg.add(new CM.Frame(Buffer.alloc(0), CM.BEGIN_DATA_STRUCTURE_FLAG));
    const b = Buffer.allocUnsafe(INT_SIZE_IN_BYTES);
    b.writeInt32LE(error.code | 0, 0);
    msg.add(new CM.Frame(b));
    StringCodec.encode(msg, error.message);
    StringCodec.encode(msg, error.originatingMemberId);
    CodecUtil.encodeNullable(msg, error.suggestion, (m, s) => StringCodec.encode(m, s));
    msg.add(new CM.Frame(Buffer.alloc(0), CM.END_DATA_STRUCTURE_FLAG));
}

function _empty(t: number): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RH); b.fill(0); b.writeUInt32LE(t >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg;
}

function _decodeDataList(iter: CM.ForwardFrameIterator): Data[] {
    const items: Data[] = [];
    if (!iter.hasNext()) return items;
    const bf = iter.peekNext();
    if (!bf || !bf.isBeginFrame()) return items;
    iter.next();
    while (iter.hasNext()) {
        const n = iter.peekNext();
        if (n && n.isEndFrame()) { iter.next(); break; }
        if (n && n.isNullFrame()) { iter.next(); continue; }
        items.push(DataCodec.decode(iter));
    }
    return items;
}
