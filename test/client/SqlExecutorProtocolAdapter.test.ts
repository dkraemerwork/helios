import { ClientMessage, ClientMessageFrame } from '@zenystx/helios-core/client/impl/protocol/ClientMessage';
import { DataCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/DataCodec.js';
import {
    BOOLEAN_SIZE_IN_BYTES,
    BYTE_SIZE_IN_BYTES,
    INT_SIZE_IN_BYTES,
    LONG_SIZE_IN_BYTES,
    UUID_SIZE_IN_BYTES,
} from '@zenystx/helios-core/client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '@zenystx/helios-core/client/impl/protocol/codec/builtin/StringCodec.js';
import { ExecutorConfig } from '@zenystx/helios-core/config/ExecutorConfig';
import { ExecutorContainerService } from '@zenystx/helios-core/executor/impl/ExecutorContainerService';
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { SerializationConfig } from '@zenystx/helios-core/internal/serialization/impl/SerializationConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';
import { afterEach, describe, expect, test } from 'bun:test';

const SQL_EXECUTE_REQUEST_TYPE = 0x210400;
const SQL_FETCH_REQUEST_TYPE = 0x210500;
const SQL_CLOSE_REQUEST_TYPE = 0x210300;

const EXEC_SHUTDOWN_REQUEST_TYPE = 0x0a0100;
const EXEC_IS_SHUTDOWN_REQUEST_TYPE = 0x0a0200;
const EXEC_CANCEL_ON_PARTITION_REQUEST_TYPE = 0x0a0400;
const EXEC_CANCEL_ON_MEMBER_REQUEST_TYPE = 0x0a0500;
const EXEC_SUBMIT_TO_PARTITION_REQUEST_TYPE = 0x0a0600;
const EXEC_SUBMIT_TO_MEMBER_REQUEST_TYPE = 0x0a0700;

const INITIAL_FRAME_SIZE = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES;
const RESPONSE_VALUE_OFFSET = ClientMessage.RESPONSE_BACKUP_ACKS_FIELD_OFFSET + BYTE_SIZE_IN_BYTES;

type QueryId = {
    localHigh: bigint;
    localLow: bigint;
    globalHigh: bigint;
    globalLow: bigint;
};

type DecodedSqlPage = {
    columnTypes: number[];
    columns: unknown[][];
    last: boolean;
};

class TestClientSession {
    readonly events: ClientMessage[] = [];

    constructor(private readonly _sessionId: string) {}

    isAuthenticated(): boolean { return true; }
    getSessionId(): string { return this._sessionId; }
    pushEvent(message: ClientMessage): boolean { this.events.push(message); return true; }
    sendMessage(message: ClientMessage): boolean { this.events.push(message); return true; }
}

function createRequest(messageType: number, correlationId: number, extraBytes = 0): { msg: ClientMessage; frame: Buffer } {
    const msg = ClientMessage.createForEncode();
    const frame = Buffer.alloc(INITIAL_FRAME_SIZE + extraBytes);
    frame.writeUInt32LE(messageType >>> 0, ClientMessage.TYPE_FIELD_OFFSET);
    frame.writeInt32LE(-1, ClientMessage.PARTITION_ID_FIELD_OFFSET);
    msg.add(new ClientMessageFrame(frame));
    msg.setCorrelationId(correlationId);
    msg.setPartitionId(-1);
    return { msg, frame };
}

function encodeDataList(msg: ClientMessage, values: Data[]): void {
    msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
    for (const value of values) {
        DataCodec.encode(msg, value);
    }
    msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.END_DATA_STRUCTURE_FLAG));
}

function buildSqlExecuteRequest(
    correlationId: number,
    queryId: QueryId,
    sql: string,
    params: Data[],
    cursorBufferSize: number,
    options?: {
        expectedResultType?: number;
        schema?: string | null;
    },
): ClientMessage {
    const extraBytes = LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES + 1 + BOOLEAN_SIZE_IN_BYTES;
    const { msg, frame } = createRequest(SQL_EXECUTE_REQUEST_TYPE, correlationId, extraBytes);
    let offset = INITIAL_FRAME_SIZE;
    frame.writeBigInt64LE(30_000n, offset);
    offset += LONG_SIZE_IN_BYTES;
    frame.writeInt32LE(cursorBufferSize, offset);
    offset += INT_SIZE_IN_BYTES;
    frame.writeUInt8(options?.expectedResultType ?? 0, offset);
    offset += 1;
    frame.writeUInt8(0, offset);
    StringCodec.encode(msg, sql);
    encodeDataList(msg, params);
    if (options?.schema === null || options?.schema === undefined) {
        msg.add(ClientMessage.NULL_FRAME);
    } else {
        StringCodec.encode(msg, options.schema);
    }
    encodeSqlQueryId(msg, queryId);
    msg.setFinal();
    return msg;
}

function buildSqlFetchRequest(correlationId: number, queryId: QueryId, cursorBufferSize: number): ClientMessage {
    const { msg, frame } = createRequest(
        SQL_FETCH_REQUEST_TYPE,
        correlationId,
        INT_SIZE_IN_BYTES,
    );
    frame.writeInt32LE(cursorBufferSize, INITIAL_FRAME_SIZE);
    encodeSqlQueryId(msg, queryId);
    msg.setFinal();
    return msg;
}

function buildSqlCloseRequest(correlationId: number, queryId: QueryId): ClientMessage {
    const { msg } = createRequest(SQL_CLOSE_REQUEST_TYPE, correlationId);
    encodeSqlQueryId(msg, queryId);
    msg.setFinal();
    return msg;
}

function encodeSqlQueryId(msg: ClientMessage, queryId: QueryId): void {
    msg.add(ClientMessage.Frame.createStaticFrame(ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
    const frame = Buffer.alloc(4 * LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(queryId.globalHigh, 0);
    frame.writeBigInt64LE(queryId.globalLow, LONG_SIZE_IN_BYTES);
    frame.writeBigInt64LE(queryId.localHigh, LONG_SIZE_IN_BYTES * 2);
    frame.writeBigInt64LE(queryId.localLow, LONG_SIZE_IN_BYTES * 3);
    msg.add(new ClientMessageFrame(frame));
    msg.add(ClientMessage.Frame.createStaticFrame(ClientMessage.END_DATA_STRUCTURE_FLAG));
}

function buildNameRequest(messageType: number, correlationId: number, name: string): ClientMessage {
    const { msg } = createRequest(messageType, correlationId);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildExecutorSubmitToPartitionRequest(
    correlationId: number,
    uuid: string,
    callable: Data,
    partitionId: number,
    name: string,
): ClientMessage {
    const { msg, frame } = createRequest(
        EXEC_SUBMIT_TO_PARTITION_REQUEST_TYPE,
        correlationId,
        UUID_SIZE_IN_BYTES + INT_SIZE_IN_BYTES,
    );
    frame.writeInt32LE(partitionId, INITIAL_FRAME_SIZE + UUID_SIZE_IN_BYTES);
    StringCodec.encode(msg, uuid);
    DataCodec.encode(msg, callable);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildExecutorSubmitToMemberRequest(
    correlationId: number,
    uuid: string,
    callable: Data,
    memberUuid: string,
    name: string,
): ClientMessage {
    const { msg } = createRequest(EXEC_SUBMIT_TO_MEMBER_REQUEST_TYPE, correlationId);
    StringCodec.encode(msg, uuid);
    DataCodec.encode(msg, callable);
    StringCodec.encode(msg, memberUuid);
    StringCodec.encode(msg, name);
    msg.setFinal();
    return msg;
}

function buildExecutorCancelOnPartitionRequest(
    correlationId: number,
    uuid: string,
    partitionId: number,
): ClientMessage {
    const { msg, frame } = createRequest(
        EXEC_CANCEL_ON_PARTITION_REQUEST_TYPE,
        correlationId,
        INT_SIZE_IN_BYTES + BOOLEAN_SIZE_IN_BYTES,
    );
    frame.writeInt32LE(partitionId, INITIAL_FRAME_SIZE);
    frame.writeUInt8(1, INITIAL_FRAME_SIZE + INT_SIZE_IN_BYTES);
    StringCodec.encode(msg, uuid);
    msg.setFinal();
    return msg;
}

function buildExecutorCancelOnMemberRequest(
    correlationId: number,
    uuid: string,
    memberUuid: string,
): ClientMessage {
    const { msg, frame } = createRequest(
        EXEC_CANCEL_ON_MEMBER_REQUEST_TYPE,
        correlationId,
        BOOLEAN_SIZE_IN_BYTES,
    );
    frame.writeUInt8(1, INITIAL_FRAME_SIZE);
    StringCodec.encode(msg, uuid);
    StringCodec.encode(msg, memberUuid);
    msg.setFinal();
    return msg;
}

function decodeBooleanResponse(message: ClientMessage): boolean {
    return message.getStartFrame().content.readUInt8(RESPONSE_VALUE_OFFSET) !== 0;
}

function decodeSqlExecuteResponse(message: ClientMessage, ss: SerializationServiceImpl): {
    updateCount: bigint;
    rowMetadata: Array<{ name: string; type: number }> | null;
    rowPage: DecodedSqlPage | null;
    errorMessage: string | null;
} {
    const iterator = message.forwardFrameIterator();
    const frame = iterator.next();
    const updateCount = frame.content.readBigInt64LE(RESPONSE_VALUE_OFFSET);
    const rowMetadata = decodeNullableSqlMetadata(iterator);
    const rowPage = decodeNullableSqlPage(iterator, ss);
    const errorMessage = decodeNullableSqlError(iterator);
    return { updateCount, rowMetadata, rowPage, errorMessage };
}

function decodeSqlFetchResponse(message: ClientMessage, ss: SerializationServiceImpl): {
    rowPage: DecodedSqlPage | null;
    errorMessage: string | null;
} {
    const iterator = message.forwardFrameIterator();
    iterator.next();
    const rowPage = decodeNullableSqlPage(iterator, ss);
    const errorMessage = decodeNullableSqlError(iterator);
    return { rowPage, errorMessage };
}

function decodeNullableSqlMetadata(
    iterator: ReturnType<ClientMessage['forwardFrameIterator']>,
): Array<{ name: string; type: number }> | null {
    const next = iterator.peekNext();
    if (next?.isNullFrame()) {
        iterator.next();
        return null;
    }

    iterator.next();
    const columns: Array<{ name: string; type: number }> = [];
    while (iterator.hasNext()) {
        const frame = iterator.peekNext();
        if (frame?.isEndFrame()) {
            iterator.next();
            break;
        }
        iterator.next();
        const columnFrame = iterator.next();
        const type = columnFrame.content.readInt32LE(0);
        const name = StringCodec.decode(iterator);
        iterator.next();
        columns.push({ name, type });
    }
    return columns;
}

function decodeNullableSqlPage(
    iterator: ReturnType<ClientMessage['forwardFrameIterator']>,
    ss: SerializationServiceImpl,
): DecodedSqlPage | null {
    const next = iterator.peekNext();
    if (next?.isNullFrame()) {
        iterator.next();
        return null;
    }

    iterator.next();
    const last = iterator.next().content.readUInt8(0) !== 0;
    const columnTypesFrame = iterator.next().content;
    const columnCount = columnTypesFrame.length / INT_SIZE_IN_BYTES;
    const columnTypes: number[] = [];
    for (let index = 0; index < columnCount; index++) {
        columnTypes.push(columnTypesFrame.readInt32LE(index * INT_SIZE_IN_BYTES));
    }

    const columns: unknown[][] = [];
    for (let index = 0; index < columnCount; index++) {
        iterator.next();
        const values: unknown[] = [];
        while (iterator.hasNext()) {
            const frame = iterator.peekNext();
            if (frame?.isEndFrame()) {
                iterator.next();
                break;
            }
            if (frame?.isNullFrame()) {
                iterator.next();
                values.push(null);
                continue;
            }
            values.push(ss.toObject(DataCodec.decode(iterator)));
        }
        columns.push(values);
    }
    iterator.next();
    return { columnTypes, columns, last };
}

function decodeNullableSqlError(iterator: ReturnType<ClientMessage['forwardFrameIterator']>): string | null {
    const next = iterator.peekNext();
    if (next?.isNullFrame()) {
        iterator.next();
        return null;
    }

    iterator.next();
    const errorFrame = iterator.next();
    const messageFrame = iterator.peekNext();
    const message = messageFrame?.isNullFrame() ? null : StringCodec.decode(iterator);
    if (messageFrame?.isNullFrame()) {
        iterator.next();
    }
    const suggestionFrame = iterator.peekNext();
    if (!suggestionFrame?.isNullFrame()) {
        StringCodec.decode(iterator);
    } else {
        iterator.next();
    }
    iterator.next();
    return message ?? `SQL error ${errorFrame.content.readInt32LE(0)}`;
}

function pageRows(page: DecodedSqlPage | null): unknown[][] {
    if (page === null || page.columns.length === 0) {
        return [];
    }
    const rowCount = page.columns[0].length;
    return Array.from({ length: rowCount }, (_, rowIndex) => page.columns.map((column) => column[rowIndex]));
}

describe('sql and executor protocol adapters', () => {
    const instances: HeliosInstanceImpl[] = [];

    afterEach(() => {
        while (instances.length > 0) {
            try { instances.pop()!.shutdown(); } catch { /* ignore */ }
        }
    });

    test('sql adapter executes, fetches, closes, and returns update counts through SqlService', async () => {
        const config = new HeliosConfig('sql-protocol-adapter');
        config.setClusterName('sql-protocol-adapter');
        config.getNetworkConfig().setClientProtocolPort(0);
        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const ss = new SerializationServiceImpl(new SerializationConfig());
        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('sql-session');
        const people = instance.getMap<string, { name: string }>('people');
        await people.put('1', { name: 'Ada' });
        await people.put('2', { name: 'Grace' });

        const queryId: QueryId = { localHigh: 1n, localLow: 2n, globalHigh: 3n, globalLow: 4n };
        const executeResponse = decodeSqlExecuteResponse(
            (await dispatcher.dispatch(
                buildSqlExecuteRequest(1, queryId, 'SELECT name FROM people ORDER BY name', [], 1),
                session,
            ))!,
            ss,
        );

        expect(executeResponse.errorMessage).toBeNull();
        expect(executeResponse.updateCount).toBe(-1n);
        expect(executeResponse.rowMetadata?.map((column) => column.name)).toEqual(['name']);
        expect(pageRows(executeResponse.rowPage)).toEqual([['Ada']]);
        expect(executeResponse.rowPage?.last).toBe(false);

        const fetchResponse = decodeSqlFetchResponse(
            (await dispatcher.dispatch(buildSqlFetchRequest(2, queryId, 1), session))!,
            ss,
        );
        expect(fetchResponse.errorMessage).toBeNull();
        expect(pageRows(fetchResponse.rowPage)).toEqual([['Grace']]);
        expect(fetchResponse.rowPage?.last).toBe(true);

        await dispatcher.dispatch(buildSqlCloseRequest(3, queryId), session);
        const closedFetchResponse = decodeSqlFetchResponse(
            (await dispatcher.dispatch(buildSqlFetchRequest(4, queryId, 1), session))!,
            ss,
        );
        expect(closedFetchResponse.rowPage).toBeNull();
        expect(closedFetchResponse.errorMessage).toContain('SQL cursor not found');

        const insertResponse = decodeSqlExecuteResponse(
            (await dispatcher.dispatch(
                buildSqlExecuteRequest(
                    5,
                    { localHigh: 5n, localLow: 6n, globalHigh: 7n, globalLow: 8n },
                    'INSERT INTO people (__key, name) VALUES (?, ?)',
                    [ss.toData('3')!, ss.toData('Linus')!],
                    16,
                ),
                session,
            ))!,
            ss,
        );
        expect(insertResponse.errorMessage).toBeNull();
        expect(insertResponse.updateCount).toBe(1n);
        expect((await people.get('3'))?.name).toBe('Linus');

        const expectedTypeErrorResponse = decodeSqlExecuteResponse(
            (await dispatcher.dispatch(
                buildSqlExecuteRequest(
                    6,
                    { localHigh: 9n, localLow: 10n, globalHigh: 11n, globalLow: 12n },
                    'SELECT name FROM people ORDER BY name',
                    [],
                    1,
                    { expectedResultType: 2 },
                ),
                session,
            ))!,
            ss,
        );
        expect(expectedTypeErrorResponse.errorMessage).toContain('update count was required');

        const schemaErrorResponse = decodeSqlExecuteResponse(
            (await dispatcher.dispatch(
                buildSqlExecuteRequest(
                    7,
                    { localHigh: 13n, localLow: 14n, globalHigh: 15n, globalLow: 16n },
                    'SELECT name FROM people',
                    [],
                    1,
                    { schema: 'tenant_a' },
                ),
                session,
            ))!,
            ss,
        );
        expect(schemaErrorResponse.errorMessage).toContain('default schema');
        expect(instance.getSql().getActiveQueryIds()).toEqual([]);
        ss.destroy();
    });

    test('executor adapter submits, cancels, shuts down, and reports shutdown state through real executor services', async () => {
        const config = new HeliosConfig('executor-protocol-adapter');
        config.setClusterName('executor-protocol-adapter');
        config.getNetworkConfig().setClientProtocolPort(0);
        const executorConfig = new ExecutorConfig('protocol-exec');
        executorConfig.setExecutionBackend('inline').setAllowInlineBackend(true);
        config.addExecutorConfig(executorConfig);

        const instance = new HeliosInstanceImpl(config);
        instances.push(instance);

        const ss = new SerializationServiceImpl(new SerializationConfig());
        const dispatcher = (instance as any)._clientProtocolServer.getDispatcher();
        const session = new TestClientSession('executor-session');
        const executor = instance.getExecutorService('protocol-exec');
        const container = instance.getNodeEngine().getService<ExecutorContainerService>('helios:executor:container:protocol-exec');
        const started: string[] = [];

        executor.registerTaskType('slow-task', async (input) => {
            const payload = input as { label: string; delayMs: number };
            started.push(payload.label);
            await Bun.sleep(payload.delayMs);
            return payload.label;
        });

        const partitionTask = ss.toData({ taskType: 'slow-task', input: { label: 'partition', delayMs: 250 } })!;
        await dispatcher.dispatch(
            buildExecutorSubmitToPartitionRequest(10, 'partition-task', partitionTask, 0, 'protocol-exec'),
            session,
        );
        await Bun.sleep(25);
        expect(started).toContain('partition');
        expect(decodeBooleanResponse((await dispatcher.dispatch(
            buildExecutorCancelOnPartitionRequest(11, 'partition-task', 0),
            session,
        ))!)).toBe(true);
        expect(decodeBooleanResponse((await dispatcher.dispatch(
            buildExecutorCancelOnPartitionRequest(12, 'partition-task', 0),
            session,
        ))!)).toBe(false);

        const memberUuid = instance.getCluster().getLocalMember().getUuid();
        const memberTask = ss.toData({ taskType: 'slow-task', input: { label: 'member', delayMs: 250 } })!;
        await dispatcher.dispatch(
            buildExecutorSubmitToMemberRequest(13, 'member-task', memberTask, memberUuid, 'protocol-exec'),
            session,
        );
        await Bun.sleep(25);
        expect(started).toContain('member');
        expect(decodeBooleanResponse((await dispatcher.dispatch(
            buildExecutorCancelOnMemberRequest(14, 'member-task', memberUuid),
            session,
        ))!)).toBe(true);

        expect(decodeBooleanResponse((await dispatcher.dispatch(
            buildNameRequest(EXEC_IS_SHUTDOWN_REQUEST_TYPE, 15, 'protocol-exec'),
            session,
        ))!)).toBe(false);
        await dispatcher.dispatch(buildNameRequest(EXEC_SHUTDOWN_REQUEST_TYPE, 16, 'protocol-exec'), session);
        expect(container.isShutdown()).toBe(true);
        expect(decodeBooleanResponse((await dispatcher.dispatch(
            buildNameRequest(EXEC_IS_SHUTDOWN_REQUEST_TYPE, 17, 'protocol-exec'),
            session,
        ))!)).toBe(true);
        await expect(dispatcher.dispatch(
            buildExecutorSubmitToPartitionRequest(18, 'shutdown-partition-task', partitionTask, 0, 'protocol-exec'),
            session,
        )).rejects.toThrow(/shut down/i);
        await expect(dispatcher.dispatch(
            buildExecutorSubmitToMemberRequest(19, 'shutdown-member-task', memberTask, memberUuid, 'protocol-exec'),
            session,
        )).rejects.toThrow(/shut down/i);

        ss.destroy();
    });
});
