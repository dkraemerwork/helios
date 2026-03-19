/**
 * Block C — Client Protocol Error Encoding
 *
 * Encodes Hazelcast protocol error responses sent back to the client.
 *
 * Wire format (Hazelcast 5.x client protocol):
 *   Initial frame content:
 *     [0..3]   messageType = 0 (exception response)
 *     [4..11]  correlationId (set by caller)
 *     [12..15] partitionId = -1
 *
 *   Following frames encode a list of ErrorHolder objects:
 *     errorCode (int)
 *     className (string)
 *     message (nullable string)
 *     stackTraceElements (list of StackTraceElement)
 *     causeErrorCode (int, 0 = no cause)
 *     causeClassName (nullable string)
 *
 * Hazelcast error codes relevant to Block C:
 *   0   = UNDEFINED_ERROR_CODE
 *   12  = AUTHENTICATION
 *   28  = TARGET_NOT_MEMBER
 *   35  = PARTITION_MIGRATING
 *   43  = RETRYABLE_HAZELCAST
 *   44  = RETRYABLE_IO
 *   46  = TARGET_DISCONNECTED
 *   33  = HAZELCAST_INSTANCE_NOT_ACTIVE
 *   75  = UNSUPPORTED_OPERATION
 */

import { ClientMessage, ClientMessageFrame } from '../../client/impl/protocol/ClientMessage.js';
import { CodecUtil } from '../../client/impl/protocol/codec/builtin/CodecUtil.js';
import { INT_SIZE_IN_BYTES, LONG_SIZE_IN_BYTES } from '../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec.js';
import { StringCodec } from '../../client/impl/protocol/codec/builtin/StringCodec.js';

// ── Error codes (Hazelcast 5.x protocol error code enum) ─────────────────────

export const enum HazelcastErrorCode {
    UNDEFINED_ERROR_CODE     = 0,
    ARRAY_INDEX_OUT_OF_BOUNDS = 1,
    ARRAY_STORE              = 2,
    AUTHENTICATION           = 12,
    CACHE_LOADER             = 14,
    CACHE_NOT_EXISTS         = 15,
    CACHE_WRITER             = 16,
    CALLER_NOT_MEMBER        = 17,
    CANCELLATION             = 18,
    CLASS_CAST               = 19,
    CLASS_NOT_FOUND          = 20,
    CONCURRENT_MODIFICATION  = 22,
    CONFIG_MISMATCH          = 23,
    DISTRIBUTED_OBJECT_DESTROYED = 25,
    HAZELCAST               = 27,
    TARGET_NOT_MEMBER        = 28,
    HAZELCAST_INSTANCE_NOT_ACTIVE = 33,
    HAZELCAST_OVERLOAD       = 34,
    PARTITION_MIGRATING      = 35,
    QUERY                   = 37,
    RETRYABLE_HAZELCAST      = 43,
    RETRYABLE_IO             = 44,
    RUNTIME                  = 45,
    TARGET_DISCONNECTED      = 46,
    TOPIC_OVERLOAD           = 50,
    TRANSACTION             = 51,
    TRANSACTION_NOT_ACTIVE   = 52,
    TRANSACTION_TIMED_OUT    = 53,
    UNSUPPORTED_OPERATION    = 75,
    ACCESS_CONTROL           = 79,
    NO_DATA_MEMBER           = 90,
    INDETERMINATE_OPERATION_STATE = 96,
    SQL_ERROR               = 119,
}

// ── Response message type ─────────────────────────────────────────────────────

/** Exception response message type (same for all errors). */
export const EXCEPTION_RESPONSE_MESSAGE_TYPE = 0x000000;

// ── Initial frame layout ──────────────────────────────────────────────────────

const RESPONSE_HEADER_CONTENT_SIZE = INT_SIZE_IN_BYTES + LONG_SIZE_IN_BYTES + INT_SIZE_IN_BYTES; // 16

// ── ErrorCodec ────────────────────────────────────────────────────────────────

/**
 * Encodes a Hazelcast protocol exception response message.
 *
 * Protocol handlers should call one of the convenience factory methods
 * (encodeAuthRequired, encodeWrongTarget, etc.) rather than calling
 * encodeError directly.
 */
export class ErrorCodec {
    private constructor() {}

    /**
     * Encode a raw error response with the given error code and message.
     *
     * @param errorCode  One of the HazelcastErrorCode values.
     * @param className  The Java class name of the exception (for client log).
     * @param message    Human-readable error message.
     * @param retryable  If true, the client may retry the operation.
     */
    static encodeError(
        errorCode: number,
        className: string,
        message: string,
        retryable = false,
    ): ClientMessage {
        const msg = ClientMessage.createForEncode();

        // Initial frame: standard 16-byte header with responseType = 0 (exception)
        const UNFRAGMENTED = ClientMessage.BEGIN_FRAGMENT_FLAG | ClientMessage.END_FRAGMENT_FLAG;
        const buf = Buffer.allocUnsafe(RESPONSE_HEADER_CONTENT_SIZE);
        buf.writeUInt32LE(EXCEPTION_RESPONSE_MESSAGE_TYPE >>> 0, 0);
        buf.fill(0, 4, RESPONSE_HEADER_CONTENT_SIZE); // correlationId + partitionId = 0
        msg.add(new ClientMessageFrame(buf, UNFRAGMENTED));

        // BEGIN outer list (one ErrorHolder)
        msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));

        // BEGIN ErrorHolder struct
        msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));

        // Fixed fields: errorCode(int) + causeErrorCode(int) packed in one frame
        const fixedBuf = Buffer.allocUnsafe(INT_SIZE_IN_BYTES + INT_SIZE_IN_BYTES);
        fixedBuf.writeInt32LE(errorCode | 0, 0);
        fixedBuf.writeInt32LE(0, INT_SIZE_IN_BYTES); // causeErrorCode = 0 (no cause)
        msg.add(new ClientMessageFrame(fixedBuf));

        // className (string)
        StringCodec.encode(msg, className);

        // message (nullable string)
        CodecUtil.encodeNullable(msg, message, (m, s) => StringCodec.encode(m, s));

        // stackTraceElements (empty list)
        msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.BEGIN_DATA_STRUCTURE_FLAG));
        msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.END_DATA_STRUCTURE_FLAG));

        // causeClassName (null)
        msg.add(ClientMessage.NULL_FRAME);

        // END ErrorHolder struct
        msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.END_DATA_STRUCTURE_FLAG));

        // END outer list
        msg.add(new ClientMessageFrame(Buffer.alloc(0), ClientMessage.END_DATA_STRUCTURE_FLAG));

        msg.setRetryable(retryable);
        msg.setFinal();
        return msg;
    }

    // ── Convenience factory methods ───────────────────────────────────────────

    /** Authentication is required but the session is not authenticated. */
    static encodeAuthRequired(): ClientMessage {
        return ErrorCodec.encodeError(
            HazelcastErrorCode.AUTHENTICATION,
            'com.hazelcast.security.SecurityException',
            'Authentication required',
            false,
        );
    }

    /** The cluster name in the reconnect request does not match. */
    static encodeClusterNameMismatch(expected: string, got: string): ClientMessage {
        return ErrorCodec.encodeError(
            HazelcastErrorCode.AUTHENTICATION,
            'com.hazelcast.security.SecurityException',
            `Cluster name mismatch: expected '${expected}', got '${got}'`,
            false,
        );
    }

    /** The opcode is not known (unregistered handler). */
    static encodeUnknownOpcode(opcode: number): ClientMessage {
        return ErrorCodec.encodeError(
            HazelcastErrorCode.UNDEFINED_ERROR_CODE,
            'com.hazelcast.core.HazelcastException',
            `Unknown client message type: 0x${opcode.toString(16).padStart(6, '0')}`,
            false,
        );
    }

    /**
     * The operation was directed at a partition owned by a different member.
     * This is retryable — the client will refresh topology and retry.
     */
    static encodeWrongTarget(partitionId: number, ownerUuid: string | null): ClientMessage {
        return ErrorCodec.encodeError(
            HazelcastErrorCode.PARTITION_MIGRATING,
            'com.hazelcast.spi.exception.WrongTargetException',
            `Partition ${partitionId} is not owned by this member` +
                (ownerUuid ? ` (owner: ${ownerUuid})` : ''),
            true,
        );
    }

    /**
     * The target member has left the cluster.
     * Retryable — client reconnects to surviving member.
     */
    static encodeTargetNotMember(targetAddress: string): ClientMessage {
        return ErrorCodec.encodeError(
            HazelcastErrorCode.TARGET_NOT_MEMBER,
            'com.hazelcast.spi.exception.TargetNotMemberException',
            `Target ${targetAddress} is not a member of the cluster`,
            true,
        );
    }

    /** Generic retryable Hazelcast exception. */
    static encodeRetryable(message: string): ClientMessage {
        return ErrorCodec.encodeError(
            HazelcastErrorCode.RETRYABLE_HAZELCAST,
            'com.hazelcast.core.HazelcastException',
            message,
            true,
        );
    }

    /** Operation not supported by this server version. */
    static encodeUnsupportedOperation(opName: string): ClientMessage {
        return ErrorCodec.encodeError(
            HazelcastErrorCode.UNSUPPORTED_OPERATION,
            'java.lang.UnsupportedOperationException',
            `Operation not supported: ${opName}`,
            false,
        );
    }

    /** Generic internal error (non-retryable). */
    static encodeGenericError(message: string): ClientMessage {
        return ErrorCodec.encodeError(
            HazelcastErrorCode.HAZELCAST,
            'com.hazelcast.core.HazelcastException',
            message,
            false,
        );
    }

    /** SQL-specific error. */
    static encodeSqlError(message: string, errorCode: number): ClientMessage {
        return ErrorCodec.encodeError(
            HazelcastErrorCode.SQL_ERROR,
            'com.hazelcast.sql.HazelcastSqlException',
            `SQL error (code=${errorCode}): ${message}`,
            false,
        );
    }

    /** Transaction error. */
    static encodeTransactionError(message: string): ClientMessage {
        return ErrorCodec.encodeError(
            HazelcastErrorCode.TRANSACTION,
            'com.hazelcast.transaction.TransactionException',
            message,
            false,
        );
    }
}
