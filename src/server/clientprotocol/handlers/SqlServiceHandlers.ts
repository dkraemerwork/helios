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

import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ClientMessage } from '../../../client/impl/protocol/ClientMessage.js';
import { ClientMessage as CM } from '../../../client/impl/protocol/ClientMessage.js';
import { CodecUtil } from '../../../client/impl/protocol/codec/builtin/CodecUtil.js';
import { DataCodec } from '../../../client/impl/protocol/codec/builtin/DataCodec.js';
import { BOOLEAN_SIZE_IN_BYTES, BYTE_SIZE_IN_BYTES, FixedSizeTypesCodec, INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES } from '../../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { ListIntegerCodec } from '../../../client/impl/protocol/codec/builtin/ListIntegerCodec.js';
import { ListMultiFrameCodec } from '../../../client/impl/protocol/codec/builtin/ListMultiFrameCodec.js';
import { StringCodec } from '../../../client/impl/protocol/codec/builtin/StringCodec.js';
import type { SqlColumnMetadata, SqlError, SqlExecuteResult, SqlFetchResult, SqlPage, SqlServiceOperations } from './ServiceOperations.js';

// ── Message type constants ─────────────────────────────────────────────────────

const SQL_CLOSE_REQUEST    = 0x210300; const SQL_CLOSE_RESPONSE    = 0x210301;
const SQL_EXECUTE_REQUEST  = 0x210400; const SQL_EXECUTE_RESPONSE  = 0x210401;
const SQL_FETCH_REQUEST    = 0x210500; const SQL_FETCH_RESPONSE    = 0x210501;

const REQUEST_HEADER_SIZE = CM.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const RESPONSE_HEADER_SIZE = CM.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + BYTE_SIZE_IN_BYTES;
const RESPONSE_UPDATE_COUNT_OFFSET = RESPONSE_HEADER_SIZE;
const RESPONSE_IS_INFINITE_ROWS_OFFSET = RESPONSE_UPDATE_COUNT_OFFSET + LONG_SIZE_IN_BYTES;
const RETAINED_SQL_PAGE_COLUMN_TYPE = 13;

/** SQL QueryId wire layout: 4 longs (memberHigh, memberLow, localHigh, localLow). */

// ── Registration ──────────────────────────────────────────────────────────────

export function registerSqlServiceHandlers(
    dispatcher: ClientMessageDispatcher,
    operations: SqlServiceOperations,
): void {
    // Sql.Execute
    dispatcher.register(SQL_EXECUTE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();

        const timeout = f.content.readBigInt64LE(REQUEST_HEADER_SIZE);
        const cursorBufferSize = f.content.readInt32LE(REQUEST_HEADER_SIZE + LONG_SIZE_IN_BYTES);
        const expectedResultType = f.content.readUInt8(REQUEST_HEADER_SIZE + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);

        const sql = StringCodec.decode(iter);
        const params = _decodeDataList(iter);
        const schema = CodecUtil.decodeNullable(iter, i => StringCodec.decode(i));
        const queryId = _decodeSqlQueryId(iter);

        const result = await operations.execute(
            sql, params, timeout, cursorBufferSize, -1,
            queryId, false, schema, expectedResultType,
        );

        return _encodeSqlExecuteResponse(result);
    });

    // Sql.Fetch
    dispatcher.register(SQL_FETCH_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        const f = iter.next();
        const cursorBufferSize = f.content.readInt32LE(REQUEST_HEADER_SIZE);

        const queryId = _decodeSqlQueryId(iter);
        const result = await operations.fetch(queryId, cursorBufferSize);

        return _encodeSqlFetchResponse(result);
    });

    // Sql.Close
    dispatcher.register(SQL_CLOSE_REQUEST, async (msg, _s) => {
        const iter = msg.forwardFrameIterator();
        iter.next();
        await operations.close(_decodeSqlQueryId(iter));
        return _empty(SQL_CLOSE_RESPONSE);
    });
}

// ── Response encoders ─────────────────────────────────────────────────────────

function _encodeSqlExecuteResponse(result: SqlExecuteResult): ClientMessage {
    const msg = CM.createForEncode();

    const fixedSize = RESPONSE_HEADER_SIZE + LONG_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES;
    const b = Buffer.allocUnsafe(fixedSize);
    b.fill(0);
    b.writeUInt32LE(SQL_EXECUTE_RESPONSE >>> 0, 0);
    b.writeBigInt64LE(result.updateCount, RESPONSE_UPDATE_COUNT_OFFSET);
    b.writeUInt8(result.isInfiniteRows ? 1 : 0, RESPONSE_IS_INFINITE_ROWS_OFFSET);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));

    // Row metadata (nullable)
    if (result.rowMetadata !== null) {
        _encodeColumnMetadataList(msg, result.rowMetadata);
    } else {
        msg.add(_nullFrame());
    }

    // Row page (nullable)
    if (result.rowPage !== null) {
        _encodeSqlPage(msg, result.rowPage);
    } else {
        msg.add(_nullFrame());
    }

    // Error (nullable)
    if (result.error !== null) {
        _encodeSqlError(msg, result.error);
    } else {
        msg.add(_nullFrame());
    }

    msg.setFinal();
    return msg;
}

function _encodeSqlFetchResponse(result: SqlFetchResult): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    b.fill(0);
    b.writeUInt32LE(SQL_FETCH_RESPONSE >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE));

    // Row page (nullable)
    if (result.rowPage !== null) {
        _encodeSqlPage(msg, result.rowPage);
    } else {
        msg.add(_nullFrame());
    }

    // Error (nullable)
    if (result.error !== null) {
        _encodeSqlError(msg, result.error);
    } else {
        msg.add(_nullFrame());
    }

    msg.setFinal();
    return msg;
}

function _encodeColumnMetadataList(msg: typeof CM.prototype, columns: SqlColumnMetadata[]): void {
    ListMultiFrameCodec.encode(msg, columns, (message, column) => {
        const b = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES);
        FixedSizeTypesCodec.encodeInt(b, 0, column.type);
        FixedSizeTypesCodec.encodeBoolean(b, INT_SIZE_IN_BYTES, column.nullable);
        message.add(CM.Frame.createStaticFrame(CM.BEGIN_DATA_STRUCTURE_FLAG));
        message.add(new CM.Frame(b));
        StringCodec.encode(message, column.name);
        message.add(CM.Frame.createStaticFrame(CM.END_DATA_STRUCTURE_FLAG));
    });
}

function _encodeSqlPage(msg: typeof CM.prototype, page: SqlPage): void {
    msg.add(CM.Frame.createStaticFrame(CM.BEGIN_DATA_STRUCTURE_FLAG));
    const lastBuf = Buffer.allocUnsafe(BOOLEAN_SIZE_IN_BYTES);
    FixedSizeTypesCodec.encodeBoolean(lastBuf, 0, page.last);
    msg.add(new CM.Frame(lastBuf));
    ListIntegerCodec.encode(msg, page.columnTypes.map(() => RETAINED_SQL_PAGE_COLUMN_TYPE));
    for (const column of page.columns) {
        msg.add(CM.Frame.createStaticFrame(CM.BEGIN_DATA_STRUCTURE_FLAG));
        for (const item of column) {
            CodecUtil.encodeNullable(msg, item, (message, data) => DataCodec.encode(message, data));
        }
        msg.add(CM.Frame.createStaticFrame(CM.END_DATA_STRUCTURE_FLAG));
    }
    msg.add(CM.Frame.createStaticFrame(CM.END_DATA_STRUCTURE_FLAG));
}

function _encodeSqlError(msg: typeof CM.prototype, error: SqlError): void {
    msg.add(CM.Frame.createStaticFrame(CM.BEGIN_DATA_STRUCTURE_FLAG));
    const b = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + UUID_SIZE_IN_BYTES);
    FixedSizeTypesCodec.encodeInt(b, 0, error.code);
    FixedSizeTypesCodec.encodeUUID(b, INT_SIZE_IN_BYTES, error.originatingMemberId);
    msg.add(new CM.Frame(b));
    CodecUtil.encodeNullable(msg, error.message, (message, value) => StringCodec.encode(message, value));
    CodecUtil.encodeNullable(msg, error.suggestion, (message, value) => StringCodec.encode(message, value));
    msg.add(CM.Frame.createStaticFrame(CM.END_DATA_STRUCTURE_FLAG));
}

function _empty(t: number): ClientMessage {
    const msg = CM.createForEncode();
    const b = Buffer.allocUnsafe(RESPONSE_HEADER_SIZE);
    b.fill(0);
    b.writeUInt32LE(t >>> 0, 0);
    const UNFRAGMENTED_MESSAGE = CM.BEGIN_FRAGMENT_FLAG | CM.END_FRAGMENT_FLAG;
    msg.add(new CM.Frame(b, UNFRAGMENTED_MESSAGE)); msg.setFinal(); return msg;
}

function _nullFrame(): InstanceType<typeof CM.Frame> {
    return CM.Frame.createStaticFrame(CM.IS_NULL_FLAG);
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

function _decodeSqlQueryId(iter: CM.ForwardFrameIterator): {
    localHigh: bigint;
    localLow: bigint;
    globalHigh: bigint;
    globalLow: bigint;
} {
    iter.next();
    const frame = iter.next();
    const globalHigh = FixedSizeTypesCodec.decodeLong(frame.content, 0);
    const globalLow = FixedSizeTypesCodec.decodeLong(frame.content, LONG_SIZE_IN_BYTES);
    const localHigh = FixedSizeTypesCodec.decodeLong(frame.content, LONG_SIZE_IN_BYTES * 2);
    const localLow = FixedSizeTypesCodec.decodeLong(frame.content, LONG_SIZE_IN_BYTES * 3);
    CodecUtil.fastForwardToEndFrame(iter);
    return { localHigh, localLow, globalHigh, globalLow };
}
