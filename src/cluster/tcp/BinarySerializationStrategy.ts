import type {
    BackupMsg,
    BlitzNodeRegisterMsg,
    BlitzTopologyResponseMsg,
    ClusterMessage,
    FinalizeJoinMsg,
    ListEventMsg,
    ListResponseMsg,
    ListStateSyncMsg,
    MembersUpdateMsg,
    MigrationAckMsg,
    MigrationDataMsg,
    MultiMapEventMsg,
    MultiMapResponseMsg,
    MultiMapStateSyncMsg,
    OperationMsg,
    PartitionStateMsg,
    QueueEventMsg,
    QueueResponseMsg,
    QueueStateSyncMsg,
    RecoverySyncResponseMsg,
    ReliableTopicBackupMsg,
    ReliableTopicMessageMsg,
    RingbufferBackupMsg,
    RingbufferResponseMsg,
    RingbufferRequestMsg,
    ReplicatedMapStateSyncMsg,
    RingbufferBackupAckMsg,
    SetEventMsg,
    SetResponseMsg,
    SetStateSyncMsg,
    TransactionBackupReplicationMsg,
    WireMemberInfo,
    WirePartitionReplica,
} from '@zenystx/helios-core/cluster/tcp/ClusterMessage';
import type { EncodedData } from '@zenystx/helios-core/cluster/tcp/DataWireCodec';
import type { SerializationStrategy } from '@zenystx/helios-core/cluster/tcp/SerializationStrategy';
import { BIG_ENDIAN, ByteArrayObjectDataInput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataInput';
import { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { wireBufferPool } from '@zenystx/helios-core/internal/util/WireBufferPool';
import type { TransactionBackupRecord } from '@zenystx/helios-core/transaction/impl/TransactionBackupRecord';
import type { TransactionBackupMessage } from '@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl';
import { decodeResponsePayload, encodeResponsePayload } from '@zenystx/helios-core/spi/impl/operationservice/OperationWireCodec';

const PROTOCOL_VERSION = 1;
const HEADER_SIZE = 11;
const NO_PARTITION = -1;

const FLAG_IS_RESPONSE = 1 << 0;
const FLAG_IS_BACKUP = 1 << 2;
const FLAG_IS_EVENT = 1 << 3;
const FLAG_IS_ERROR = 1 << 4;

const MESSAGE_TYPE_TO_ID = {
    HELLO: 1,
    MAP_PUT: 2,
    MAP_REMOVE: 3,
    MAP_CLEAR: 4,
    INVALIDATE: 5,
    JOIN_REQUEST: 6,
    FINALIZE_JOIN: 7,
    MEMBERS_UPDATE: 8,
    PARTITION_STATE: 9,
    HEARTBEAT: 10,
    FETCH_MEMBERS_VIEW: 11,
    MEMBERS_VIEW_RESPONSE: 12,
    OPERATION: 13,
    OPERATION_RESPONSE: 14,
    BACKUP: 15,
    BACKUP_ACK: 16,
    RECOVERY_ANTI_ENTROPY: 17,
    RECOVERY_SYNC_REQUEST: 18,
    RECOVERY_SYNC_RESPONSE: 19,
    QUEUE_REQUEST: 20,
    QUEUE_RESPONSE: 21,
    QUEUE_STATE_SYNC: 22,
    QUEUE_STATE_ACK: 23,
    QUEUE_EVENT: 24,
    TOPIC_MESSAGE: 25,
    TOPIC_PUBLISH_REQUEST: 26,
    TOPIC_ACK: 27,
    RELIABLE_TOPIC_PUBLISH_REQUEST: 28,
    RELIABLE_TOPIC_PUBLISH_ACK: 29,
    RELIABLE_TOPIC_MESSAGE: 30,
    RELIABLE_TOPIC_BACKUP: 31,
    RELIABLE_TOPIC_BACKUP_ACK: 32,
    RELIABLE_TOPIC_DESTROY: 33,
    BLITZ_NODE_REGISTER: 34,
    BLITZ_NODE_REMOVE: 35,
    BLITZ_TOPOLOGY_REQUEST: 36,
    BLITZ_TOPOLOGY_RESPONSE: 37,
    BLITZ_TOPOLOGY_ANNOUNCE: 38,
    LIST_REQUEST: 39,
    LIST_RESPONSE: 40,
    LIST_STATE_SYNC: 41,
    LIST_STATE_ACK: 42,
    LIST_EVENT: 43,
    SET_REQUEST: 44,
    SET_RESPONSE: 45,
    SET_STATE_SYNC: 46,
    SET_STATE_ACK: 47,
    MULTIMAP_REQUEST: 48,
    MULTIMAP_RESPONSE: 49,
    MULTIMAP_STATE_SYNC: 50,
    MULTIMAP_STATE_ACK: 51,
    SET_EVENT: 52,
    MULTIMAP_EVENT: 53,
    REPLICATED_MAP_PUT: 54,
    REPLICATED_MAP_REMOVE: 55,
    REPLICATED_MAP_CLEAR: 56,
    REPLICATED_MAP_STATE_SYNC: 57,
    REPLICATED_MAP_STATE_ACK: 58,
    TXN_BACKUP_REPLICATION: 59,
    TXN_BACKUP_REPLICATION_ACK: 60,
    RINGBUFFER_REQUEST: 61,
    RINGBUFFER_RESPONSE: 62,
    RINGBUFFER_BACKUP: 63,
    RINGBUFFER_BACKUP_ACK: 64,
    MIGRATION_DATA: 65,
    MIGRATION_ACK: 66,
    RAFT_PRE_VOTE_REQUEST: 67,
    RAFT_PRE_VOTE_RESPONSE: 68,
    RAFT_VOTE_REQUEST: 69,
    RAFT_VOTE_RESPONSE: 70,
    RAFT_APPEND_REQUEST: 71,
    RAFT_APPEND_SUCCESS: 72,
    RAFT_APPEND_FAILURE: 73,
    RAFT_INSTALL_SNAPSHOT: 74,
    RAFT_INSTALL_SNAPSHOT_RESPONSE: 75,
    RAFT_TRIGGER_ELECTION: 76,
    WAN_REPLICATION_EVENT_BATCH: 77,
    WAN_REPLICATION_ACK: 78,
    WAN_SYNC_REQUEST: 79,
    WAN_SYNC_RESPONSE: 80,
    WAN_CONSISTENCY_CHECK_REQUEST: 81,
    WAN_CONSISTENCY_CHECK_RESPONSE: 82,
} as const satisfies Record<ClusterMessage['type'], number>;

type MessageTypeId = (typeof MESSAGE_TYPE_TO_ID)[keyof typeof MESSAGE_TYPE_TO_ID];
const MESSAGE_ID_TO_TYPE = Object.fromEntries(
    Object.entries(MESSAGE_TYPE_TO_ID).map(([type, id]) => [id, type]),
) as Record<MessageTypeId, ClusterMessage['type']>;

export class BinarySerializationStrategy implements SerializationStrategy {
    serialize(message: ClusterMessage): Uint8Array {
        const out = wireBufferPool.takeOutputBuffer();
        try {
            this.serializeInto(out, message);
            return out.toByteArray();
        } finally {
            wireBufferPool.returnOutputBuffer(out);
        }
    }

    serializeInto(out: ByteArrayObjectDataOutput, message: ClusterMessage): void {
        out.reset();
        out.writeByte(PROTOCOL_VERSION);
        out.writeShort(this._buildFlags(message));
        out.writeInt(this._partitionId(message));
        const payloadSizeOffset = out.position() as number;
        out.writeInt(0);

        const payloadStart = out.position() as number;
        out.writeShort(MESSAGE_TYPE_TO_ID[message.type]);
        this._writeMessageBody(out, message);
        out.writeInt(payloadSizeOffset, (out.position() as number) - payloadStart);
    }

    deserialize(buffer: Uint8Array): ClusterMessage {
        const inp = wireBufferPool.takeInputBuffer(toBufferView(buffer));
        try {
            const version = inp.readUnsignedByte();
            if (version !== PROTOCOL_VERSION) {
                throw new Error(`Unsupported protocol version: ${version}`);
            }
            const flags = inp.readUnsignedShort();
            const partitionId = inp.readInt();
            const payloadSize = inp.readInt();
            const payloadStart = inp.position() as number;
            const messageTypeId = inp.readUnsignedShort() as MessageTypeId;
            const message = this._readMessageBody(inp, messageTypeId, flags, partitionId);
            const bytesRead = (inp.position() as number) - payloadStart;
            if (bytesRead !== payloadSize) {
                throw new Error(`Malformed packet payload size: expected ${payloadSize}, read ${bytesRead}`);
            }
            return message;
        } finally {
            wireBufferPool.returnInputBuffer(inp);
        }
    }

    private _writeMessageBody(out: ByteArrayObjectDataOutput, message: ClusterMessage): void {
        switch (message.type) {
            case 'HELLO':
                out.writeString(message.nodeId);
                out.writeString(message.protocol);
                out.writeInt(message.protocolVersion);
                out.writeInt(message.minSupportedProtocolVersion);
                out.writeStringArray(message.capabilities);
                out.writeStringArray(message.requiredCapabilities);
                return;
            case 'MAP_PUT':
                out.writeString(message.mapName);
                writeUnknownValue(out, message.key);
                writeUnknownValue(out, message.value);
                return;
            case 'MAP_REMOVE':
                out.writeString(message.mapName);
                writeUnknownValue(out, message.key);
                return;
            case 'MAP_CLEAR':
                out.writeString(message.mapName);
                return;
            case 'INVALIDATE':
                out.writeString(message.mapName);
                writeUnknownValue(out, message.key);
                return;
            case 'JOIN_REQUEST':
                writeAddress(out, message.joinerAddress);
                out.writeString(message.joinerUuid);
                out.writeString(message.clusterName);
                out.writeInt(message.partitionCount);
                writeMemberVersion(out, message.joinerVersion);
                writeOptionalAddress(out, message.joinerClientEndpoint);
                writeOptionalAddress(out, message.joinerRestEndpoint);
                return;
            case 'FINALIZE_JOIN':
            case 'MEMBERS_UPDATE':
                writeMembershipMessage(out, message);
                return;
            case 'PARTITION_STATE':
                writePartitionState(out, message);
                return;
            case 'HEARTBEAT':
                out.writeString(message.senderUuid);
                out.writeLong(BigInt(message.timestamp));
                return;
            case 'FETCH_MEMBERS_VIEW':
                out.writeString(message.requesterId);
                out.writeLong(BigInt(message.requestTimestamp));
                return;
            case 'MEMBERS_VIEW_RESPONSE':
                out.writeInt(message.memberListVersion);
                writeWireMembers(out, message.members);
                return;
            case 'OPERATION':
                writeOperationMessage(out, message);
                return;
            case 'OPERATION_RESPONSE': {
                out.writeLong(BigInt(message.callId));
                out.writeInt(message.backupAcks);
                out.writeStringArray(message.backupMemberIds);
                const encoded = encodeResponsePayload(message.payload);
                out.writeByte(message.error !== null ? 7 : encoded.kind);
                if (message.error !== null) {
                    out.writeString('Error');
                    out.writeString(message.error);
                    out.writeString(null);
                } else {
                    out.writeByteArray(encoded.payload);
                }
                return;
            }
            case 'BACKUP':
                writeBackupMessage(out, message);
                return;
            case 'BACKUP_ACK':
                out.writeLong(BigInt(message.callId));
                out.writeString(message.senderId);
                return;
            case 'RECOVERY_ANTI_ENTROPY':
                out.writeString(message.senderId);
                out.writeInt(message.partitionId);
                out.writeInt(message.replicaIndex);
                writeLongStringArray(out, message.primaryVersions);
                writeStringArrayMap(out, message.namespaceVersions);
                return;
            case 'RECOVERY_SYNC_REQUEST':
                out.writeString(message.requestId);
                out.writeString(message.requesterId);
                out.writeInt(message.partitionId);
                out.writeInt(message.replicaIndex);
                out.writeStringArray(message.dirtyNamespaces);
                return;
            case 'RECOVERY_SYNC_RESPONSE':
                writeRecoverySyncResponse(out, message);
                return;
            case 'QUEUE_REQUEST':
                out.writeString(message.requestId);
                out.writeString(message.sourceNodeId);
                out.writeString(message.queueName);
                out.writeString(message.operation);
                out.writeString(message.txnDedupeId ?? null);
                out.writeLong(BigInt(message.timeoutMs ?? -1));
                writeOptionalEncodedData(out, message.data ?? null);
                writeEncodedDataArray(out, message.dataList ?? []);
                out.writeInt(message.maxElements ?? -1);
                return;
            case 'QUEUE_RESPONSE':
                writeQueueResponse(out, message);
                return;
            case 'QUEUE_STATE_SYNC':
                writeQueueStateSync(out, message);
                return;
            case 'QUEUE_STATE_ACK':
                out.writeString(message.requestId);
                out.writeString(message.queueName);
                out.writeLong(BigInt(message.version));
                return;
            case 'QUEUE_EVENT':
                writeQueueEvent(out, message);
                return;
            case 'RINGBUFFER_REQUEST':
                out.writeString(message.requestId);
                out.writeString(message.sourceNodeId);
                out.writeString(message.rbName);
                out.writeString(message.operation);
                out.writeLong(BigInt(message.sequence ?? -1));
                out.writeInt(message.minCount ?? -1);
                out.writeInt(message.maxCount ?? -1);
                out.writeInt(message.overflowPolicy ?? -1);
                writeOptionalEncodedData(out, message.data ?? null);
                writeEncodedDataArray(out, message.dataList ?? []);
                return;
            case 'RINGBUFFER_RESPONSE':
                writeRingbufferResponse(out, message);
                return;
            case 'RINGBUFFER_BACKUP':
                writeRingbufferBackup(out, message);
                return;
            case 'RINGBUFFER_BACKUP_ACK':
                out.writeString(message.requestId);
                return;
            case 'TOPIC_MESSAGE':
                out.writeString(message.topicName);
                writeEncodedData(out, message.data);
                out.writeLong(BigInt(message.publishTime));
                out.writeString(message.sourceNodeId);
                out.writeLong(BigInt(message.sequence ?? -1));
                return;
            case 'TOPIC_PUBLISH_REQUEST':
                out.writeString(message.requestId);
                out.writeString(message.topicName);
                writeEncodedData(out, message.data);
                out.writeLong(BigInt(message.publishTime));
                out.writeString(message.sourceNodeId);
                return;
            case 'TOPIC_ACK':
                out.writeString(message.requestId);
                out.writeString(message.error ?? null);
                return;
            case 'RELIABLE_TOPIC_PUBLISH_REQUEST':
                out.writeString(message.requestId);
                out.writeString(message.topicName);
                writeEncodedData(out, message.data);
                out.writeString(message.sourceNodeId);
                return;
            case 'RELIABLE_TOPIC_PUBLISH_ACK':
                out.writeString(message.requestId);
                out.writeString(message.error ?? null);
                return;
            case 'RELIABLE_TOPIC_MESSAGE':
                writeReliableTopicMessage(out, message);
                return;
            case 'RELIABLE_TOPIC_BACKUP':
                writeReliableTopicBackup(out, message);
                return;
            case 'RELIABLE_TOPIC_BACKUP_ACK':
                out.writeString(message.requestId);
                return;
            case 'RELIABLE_TOPIC_DESTROY':
                out.writeString(message.topicName);
                return;
            case 'BLITZ_NODE_REGISTER':
                writeBlitzRegistration(out, message);
                return;
            case 'BLITZ_NODE_REMOVE':
                out.writeString(message.memberId);
                return;
            case 'BLITZ_TOPOLOGY_REQUEST':
                out.writeString(message.requestId);
                return;
            case 'BLITZ_TOPOLOGY_RESPONSE':
                writeBlitzTopologyResponse(out, message);
                return;
            case 'BLITZ_TOPOLOGY_ANNOUNCE':
                out.writeInt(message.memberListVersion);
                out.writeStringArray(message.routes);
                out.writeString(message.masterMemberId);
                out.writeString(message.fenceToken);
                return;
            case 'LIST_REQUEST':
                out.writeString(message.requestId);
                out.writeString(message.sourceNodeId);
                out.writeString(message.listName);
                out.writeString(message.operation);
                out.writeString(message.txnDedupeId ?? null);
                out.writeInt(message.index ?? -1);
                out.writeInt(message.fromIndex ?? -1);
                out.writeInt(message.toIndex ?? -1);
                writeOptionalEncodedData(out, message.data ?? null);
                writeEncodedDataArray(out, message.dataList ?? null);
                return;
            case 'LIST_RESPONSE':
                writeListResponse(out, message);
                return;
            case 'LIST_STATE_SYNC':
                writeListStateSync(out, message);
                return;
            case 'LIST_STATE_ACK':
                out.writeString(message.requestId);
                out.writeString(message.listName);
                out.writeLong(BigInt(message.version));
                return;
            case 'LIST_EVENT':
                writeListEvent(out, message);
                return;
            case 'SET_REQUEST':
                out.writeString(message.requestId);
                out.writeString(message.sourceNodeId);
                out.writeString(message.setName);
                out.writeString(message.operation);
                out.writeString(message.txnDedupeId ?? null);
                writeOptionalEncodedData(out, message.data ?? null);
                writeEncodedDataArray(out, message.dataList ?? null);
                return;
            case 'SET_RESPONSE':
                writeSetResponse(out, message);
                return;
            case 'SET_STATE_SYNC':
                writeSetStateSync(out, message);
                return;
            case 'SET_STATE_ACK':
                out.writeString(message.requestId);
                out.writeString(message.setName);
                out.writeLong(BigInt(message.version));
                return;
            case 'SET_EVENT':
                writeSetEvent(out, message);
                return;
            case 'MULTIMAP_REQUEST':
                out.writeString(message.requestId);
                out.writeString(message.sourceNodeId);
                out.writeString(message.mapName);
                out.writeString(message.operation);
                out.writeString(message.txnDedupeId ?? null);
                writeOptionalEncodedData(out, message.keyData ?? null);
                writeOptionalEncodedData(out, message.valueData ?? null);
                writeEncodedDataArray(out, message.dataList ?? null);
                return;
            case 'MULTIMAP_RESPONSE':
                writeMultiMapResponse(out, message);
                return;
            case 'MULTIMAP_STATE_SYNC':
                writeMultiMapStateSync(out, message);
                return;
            case 'MULTIMAP_STATE_ACK':
                out.writeString(message.requestId);
                out.writeString(message.mapName);
                out.writeLong(BigInt(message.version));
                return;
            case 'MULTIMAP_EVENT':
                writeMultiMapEvent(out, message);
                return;
            case 'REPLICATED_MAP_PUT':
                out.writeString(message.mapName);
                out.writeLong(BigInt(message.version));
                out.writeString(message.sourceNodeId);
                writeEncodedData(out, message.keyData);
                writeEncodedData(out, message.valueData);
                return;
            case 'REPLICATED_MAP_REMOVE':
                out.writeString(message.mapName);
                out.writeLong(BigInt(message.version));
                out.writeString(message.sourceNodeId);
                writeEncodedData(out, message.keyData);
                return;
            case 'REPLICATED_MAP_CLEAR':
                out.writeString(message.mapName);
                out.writeLong(BigInt(message.version));
                out.writeString(message.sourceNodeId);
                return;
            case 'REPLICATED_MAP_STATE_SYNC':
                writeReplicatedMapStateSync(out, message);
                return;
            case 'REPLICATED_MAP_STATE_ACK':
                out.writeString(message.requestId);
                out.writeString(message.mapName);
                out.writeLong(BigInt(message.version));
                return;
            case 'TXN_BACKUP_REPLICATION':
                out.writeString(message.requestId);
                out.writeString(message.sourceNodeId);
                writeTransactionBackupMessage(out, message.payload);
                return;
            case 'TXN_BACKUP_REPLICATION_ACK':
                out.writeString(message.requestId);
                out.writeString(message.txnId);
                out.writeBoolean(message.applied);
                return;
            case 'MIGRATION_DATA':
                writeMigrationData(out, message);
                return;
            case 'MIGRATION_ACK':
                out.writeString(message.migrationId);
                out.writeBoolean(message.success);
                out.writeString(message.error ?? null);
                return;
            case 'RAFT_PRE_VOTE_REQUEST':
                out.writeString(message.groupId);
                out.writeString(message.candidateId);
                out.writeInt(message.nextTerm);
                out.writeInt(message.lastLogTerm);
                out.writeInt(message.lastLogIndex);
                return;
            case 'RAFT_PRE_VOTE_RESPONSE':
                out.writeString(message.groupId);
                out.writeInt(message.term);
                out.writeBoolean(message.granted);
                out.writeString(message.voterId);
                return;
            case 'RAFT_VOTE_REQUEST':
                out.writeString(message.groupId);
                out.writeInt(message.term);
                out.writeString(message.candidateId);
                out.writeInt(message.lastLogTerm);
                out.writeInt(message.lastLogIndex);
                return;
            case 'RAFT_VOTE_RESPONSE':
                out.writeString(message.groupId);
                out.writeInt(message.term);
                out.writeBoolean(message.voteGranted);
                out.writeString(message.voterId);
                return;
            case 'RAFT_APPEND_REQUEST':
                out.writeString(message.groupId);
                out.writeInt(message.term);
                out.writeString(message.leaderId);
                out.writeInt(message.prevLogIndex);
                out.writeInt(message.prevLogTerm);
                out.writeInt(message.entries.length);
                for (const entry of message.entries) {
                    out.writeInt(entry.term);
                    out.writeInt(entry.index);
                    out.writeString(JSON.stringify(entry.command));
                }
                out.writeInt(message.leaderCommit);
                return;
            case 'RAFT_APPEND_SUCCESS':
                out.writeString(message.groupId);
                out.writeInt(message.term);
                out.writeString(message.followerId);
                out.writeInt(message.lastLogIndex);
                return;
            case 'RAFT_APPEND_FAILURE':
                out.writeString(message.groupId);
                out.writeInt(message.term);
                out.writeString(message.followerId);
                out.writeInt(message.lastLogIndex);
                return;
            case 'RAFT_INSTALL_SNAPSHOT':
                out.writeString(message.groupId);
                out.writeInt(message.term);
                out.writeString(message.leaderId);
                out.writeInt(message.snapshot.term);
                out.writeInt(message.snapshot.index);
                out.writeByteArray(Buffer.from(message.snapshot.data));
                out.writeInt(message.snapshot.groupMembersLogIndex);
                out.writeInt(message.snapshot.groupMembers.length);
                for (const member of message.snapshot.groupMembers) {
                    out.writeString(member.uuid);
                    out.writeString(member.address.host);
                    out.writeInt(member.address.port);
                }
                return;
            case 'RAFT_INSTALL_SNAPSHOT_RESPONSE':
                out.writeString(message.groupId);
                out.writeInt(message.term);
                out.writeString(message.followerId);
                out.writeBoolean(message.success);
                out.writeInt(message.lastLogIndex);
                return;
            case 'RAFT_TRIGGER_ELECTION':
                out.writeString(message.groupId);
                return;
            case 'WAN_REPLICATION_EVENT_BATCH':
                out.writeString(message.batchId);
                out.writeString(message.sourceClusterName);
                out.writeInt(message.events.length);
                for (const ev of message.events) {
                    out.writeString(ev.mapName);
                    out.writeString(ev.eventType);
                    writeOptionalByteArray(out, ev.keyData);
                    writeOptionalByteArray(out, ev.valueData);
                    out.writeLong(BigInt(ev.ttl));
                }
                return;
            case 'WAN_REPLICATION_ACK':
                out.writeString(message.batchId);
                out.writeBoolean(message.success);
                out.writeString(message.error ?? null);
                return;
            case 'WAN_SYNC_REQUEST':
                out.writeString(message.requestId);
                out.writeString(message.sourceClusterName);
                out.writeString(message.mapName);
                out.writeBoolean(message.fullSync);
                return;
            case 'WAN_SYNC_RESPONSE':
                out.writeString(message.requestId);
                out.writeBoolean(message.accepted);
                out.writeString(message.error ?? null);
                return;
            case 'WAN_CONSISTENCY_CHECK_REQUEST':
                out.writeString(message.requestId);
                out.writeString(message.sourceClusterName);
                out.writeString(message.mapName);
                out.writeString(message.merkleRootHex);
                return;
            case 'WAN_CONSISTENCY_CHECK_RESPONSE':
                out.writeString(message.requestId);
                out.writeBoolean(message.consistent);
                out.writeInt(message.differingLeafCount);
                return;
        }
    }

    private _readMessageBody(inp: ByteArrayObjectDataInput, messageTypeId: MessageTypeId, _flags: number, partitionId: number): ClusterMessage {
        switch (MESSAGE_ID_TO_TYPE[messageTypeId]) {
            case 'HELLO':
                return {
                    type: 'HELLO',
                    nodeId: readRequiredString(inp),
                    protocol: readRequiredString(inp),
                    protocolVersion: inp.readInt(),
                    minSupportedProtocolVersion: inp.readInt(),
                    capabilities: inp.readStringArray() ?? [],
                    requiredCapabilities: inp.readStringArray() ?? [],
                };
            case 'MAP_PUT':
                return { type: 'MAP_PUT', mapName: readRequiredString(inp), key: readUnknownValue(inp), value: readUnknownValue(inp) };
            case 'MAP_REMOVE':
                return { type: 'MAP_REMOVE', mapName: readRequiredString(inp), key: readUnknownValue(inp) };
            case 'MAP_CLEAR':
                return { type: 'MAP_CLEAR', mapName: readRequiredString(inp) };
            case 'INVALIDATE':
                return { type: 'INVALIDATE', mapName: readRequiredString(inp), key: readUnknownValue(inp) };
            case 'JOIN_REQUEST':
                return {
                    type: 'JOIN_REQUEST',
                    joinerAddress: readAddress(inp),
                    joinerUuid: readRequiredString(inp),
                    clusterName: readRequiredString(inp),
                    partitionCount: inp.readInt(),
                    joinerVersion: readMemberVersion(inp),
                    joinerClientEndpoint: readOptionalAddress(inp),
                    joinerRestEndpoint: readOptionalAddress(inp),
                };
            case 'FINALIZE_JOIN':
                return readMembershipMessage(inp, 'FINALIZE_JOIN');
            case 'MEMBERS_UPDATE':
                return readMembershipMessage(inp, 'MEMBERS_UPDATE');
            case 'PARTITION_STATE':
                return readPartitionState(inp);
            case 'HEARTBEAT':
                return { type: 'HEARTBEAT', senderUuid: readRequiredString(inp), timestamp: Number(inp.readLong()) };
            case 'FETCH_MEMBERS_VIEW':
                return { type: 'FETCH_MEMBERS_VIEW', requesterId: readRequiredString(inp), requestTimestamp: Number(inp.readLong()) };
            case 'MEMBERS_VIEW_RESPONSE':
                return { type: 'MEMBERS_VIEW_RESPONSE', memberListVersion: inp.readInt(), members: readWireMembers(inp) };
            case 'OPERATION':
                return {
                    type: 'OPERATION',
                    callId: Number(inp.readLong()),
                    partitionId,
                    senderId: readRequiredString(inp),
                    factoryId: inp.readUnsignedShort(),
                    classId: inp.readUnsignedShort(),
                    payload: inp.readByteArray() ?? Buffer.alloc(0),
                };
            case 'OPERATION_RESPONSE': {
                const callId = Number(inp.readLong());
                const backupAcks = inp.readInt();
                const backupMemberIds = inp.readStringArray() ?? [];
                const kind = inp.readUnsignedByte();
                if (kind === 7) {
                    inp.readString();
                    const message = inp.readString();
                    inp.readString();
                    return {
                        type: 'OPERATION_RESPONSE',
                        callId,
                        backupAcks,
                        backupMemberIds,
                        payload: null,
                        error: message ?? 'Unknown remote error',
                    };
                }
                return {
                    type: 'OPERATION_RESPONSE',
                    callId,
                    backupAcks,
                    backupMemberIds,
                    payload: decodeResponsePayload(kind, inp.readByteArray() ?? Buffer.alloc(0)),
                    error: null,
                };
            }
            case 'BACKUP':
                return {
                    type: 'BACKUP',
                    callId: Number(inp.readLong()),
                    partitionId,
                    replicaIndex: inp.readInt(),
                    senderId: readRequiredString(inp),
                    callerId: readRequiredString(inp),
                    sync: inp.readBoolean(),
                    replicaVersions: readLongStringArray(inp),
                    factoryId: inp.readUnsignedShort(),
                    classId: inp.readUnsignedShort(),
                    payload: inp.readByteArray() ?? Buffer.alloc(0),
                };
            case 'BACKUP_ACK':
                return { type: 'BACKUP_ACK', callId: Number(inp.readLong()), senderId: readRequiredString(inp) };
            case 'RECOVERY_ANTI_ENTROPY':
                return {
                    type: 'RECOVERY_ANTI_ENTROPY',
                    senderId: readRequiredString(inp),
                    partitionId: inp.readInt(),
                    replicaIndex: inp.readInt(),
                    primaryVersions: readLongStringArray(inp),
                    namespaceVersions: readStringArrayMap(inp),
                };
            case 'RECOVERY_SYNC_REQUEST':
                return {
                    type: 'RECOVERY_SYNC_REQUEST',
                    requestId: readRequiredString(inp),
                    requesterId: readRequiredString(inp),
                    partitionId: inp.readInt(),
                    replicaIndex: inp.readInt(),
                    dirtyNamespaces: inp.readStringArray() ?? [],
                };
            case 'RECOVERY_SYNC_RESPONSE':
                return readRecoverySyncResponse(inp);
            case 'QUEUE_REQUEST':
                return {
                    type: 'QUEUE_REQUEST',
                    requestId: readRequiredString(inp),
                    sourceNodeId: readRequiredString(inp),
                    queueName: readRequiredString(inp),
                    operation: readRequiredString(inp),
                    ...( (() => { const txnDedupeId = inp.readString() ?? undefined; return txnDedupeId !== undefined ? { txnDedupeId } : {}; })() ),
                    timeoutMs: readMinusOneAsUndefined(inp),
                    data: readOptionalEncodedData(inp) ?? undefined,
                    dataList: readEncodedDataArray(inp) ?? undefined,
                    maxElements: readIntMinusOneAsUndefined(inp),
                };
            case 'QUEUE_RESPONSE':
                return readQueueResponse(inp);
            case 'QUEUE_STATE_SYNC':
                return readQueueStateSync(inp);
            case 'QUEUE_STATE_ACK':
                return { type: 'QUEUE_STATE_ACK', requestId: readRequiredString(inp), queueName: readRequiredString(inp), version: Number(inp.readLong()) };
            case 'QUEUE_EVENT':
                return readQueueEvent(inp);
            case 'RINGBUFFER_REQUEST': {
                const requestId = readRequiredString(inp);
                const sourceNodeId = readRequiredString(inp);
                const rbName = readRequiredString(inp);
                const operation = readRequiredString(inp);
                const sequence = readMinusOneAsUndefined(inp);
                const minCount = readIntMinusOneAsUndefined(inp);
                const maxCount = readIntMinusOneAsUndefined(inp);
                const overflowPolicy = readIntMinusOneAsUndefined(inp);
                const data = readOptionalEncodedData(inp) ?? undefined;
                const dataList = readEncodedDataArray(inp) ?? undefined;
                return {
                    type: 'RINGBUFFER_REQUEST',
                    requestId,
                    sourceNodeId,
                    rbName,
                    operation,
                    ...(sequence !== undefined ? { sequence } : {}),
                    ...(minCount !== undefined ? { minCount } : {}),
                    ...(maxCount !== undefined ? { maxCount } : {}),
                    ...(overflowPolicy !== undefined ? { overflowPolicy } : {}),
                    ...(data !== undefined ? { data } : {}),
                    ...(dataList !== undefined ? { dataList } : {}),
                };
            }
            case 'RINGBUFFER_RESPONSE':
                return readRingbufferResponse(inp);
            case 'RINGBUFFER_BACKUP':
                return readRingbufferBackup(inp);
            case 'RINGBUFFER_BACKUP_ACK':
                return { type: 'RINGBUFFER_BACKUP_ACK', requestId: readRequiredString(inp) };
            case 'TOPIC_MESSAGE':
                return { type: 'TOPIC_MESSAGE', topicName: readRequiredString(inp), data: readEncodedData(inp), publishTime: Number(inp.readLong()), sourceNodeId: readRequiredString(inp), sequence: readMinusOneAsNull(inp) };
            case 'TOPIC_PUBLISH_REQUEST':
                return { type: 'TOPIC_PUBLISH_REQUEST', requestId: readRequiredString(inp), topicName: readRequiredString(inp), data: readEncodedData(inp), publishTime: Number(inp.readLong()), sourceNodeId: readRequiredString(inp) };
            case 'TOPIC_ACK':
                return { type: 'TOPIC_ACK', requestId: readRequiredString(inp), error: inp.readString() ?? undefined };
            case 'RELIABLE_TOPIC_PUBLISH_REQUEST':
                return { type: 'RELIABLE_TOPIC_PUBLISH_REQUEST', requestId: readRequiredString(inp), topicName: readRequiredString(inp), data: readEncodedData(inp), sourceNodeId: readRequiredString(inp) };
            case 'RELIABLE_TOPIC_PUBLISH_ACK':
                return { type: 'RELIABLE_TOPIC_PUBLISH_ACK', requestId: readRequiredString(inp), error: inp.readString() ?? undefined };
            case 'RELIABLE_TOPIC_MESSAGE':
                return readReliableTopicMessage(inp);
            case 'RELIABLE_TOPIC_BACKUP':
                return readReliableTopicBackup(inp);
            case 'RELIABLE_TOPIC_BACKUP_ACK':
                return { type: 'RELIABLE_TOPIC_BACKUP_ACK', requestId: readRequiredString(inp) };
            case 'RELIABLE_TOPIC_DESTROY':
                return { type: 'RELIABLE_TOPIC_DESTROY', topicName: readRequiredString(inp) };
            case 'BLITZ_NODE_REGISTER':
                return readBlitzRegistration(inp);
            case 'BLITZ_NODE_REMOVE':
                return { type: 'BLITZ_NODE_REMOVE', memberId: readRequiredString(inp) };
            case 'BLITZ_TOPOLOGY_REQUEST':
                return { type: 'BLITZ_TOPOLOGY_REQUEST', requestId: readRequiredString(inp) };
            case 'BLITZ_TOPOLOGY_RESPONSE':
                return readBlitzTopologyResponse(inp);
            case 'BLITZ_TOPOLOGY_ANNOUNCE':
                return { type: 'BLITZ_TOPOLOGY_ANNOUNCE', memberListVersion: inp.readInt(), routes: inp.readStringArray() ?? [], masterMemberId: readRequiredString(inp), fenceToken: readRequiredString(inp) };
            case 'LIST_REQUEST': {
                const requestId = readRequiredString(inp);
                const sourceNodeId = readRequiredString(inp);
                const listName = readRequiredString(inp);
                const operation = readRequiredString(inp);
                const txnDedupeId = inp.readString() ?? undefined;
                const index = readIntMinusOneAsUndefined(inp);
                const fromIndex = readIntMinusOneAsUndefined(inp);
                const toIndex = readIntMinusOneAsUndefined(inp);
                const data = readOptionalEncodedData(inp) ?? undefined;
                const dataList = readEncodedDataArray(inp) ?? undefined;
                return { type: 'LIST_REQUEST', requestId, sourceNodeId, listName, operation, ...(txnDedupeId !== undefined ? { txnDedupeId } : {}), ...(index !== undefined ? { index } : {}), ...(fromIndex !== undefined ? { fromIndex } : {}), ...(toIndex !== undefined ? { toIndex } : {}), ...(data !== undefined ? { data } : {}), ...(dataList !== undefined ? { dataList } : {}) };
            }
            case 'LIST_RESPONSE':
                return readListResponse(inp);
            case 'LIST_STATE_SYNC':
                return readListStateSync(inp);
            case 'LIST_STATE_ACK':
                return { type: 'LIST_STATE_ACK', requestId: readRequiredString(inp), listName: readRequiredString(inp), version: Number(inp.readLong()) };
            case 'LIST_EVENT':
                return readListEvent(inp);
            case 'SET_REQUEST': {
                const requestId = readRequiredString(inp);
                const sourceNodeId = readRequiredString(inp);
                const setName = readRequiredString(inp);
                const operation = readRequiredString(inp);
                const txnDedupeId = inp.readString() ?? undefined;
                const data = readOptionalEncodedData(inp) ?? undefined;
                const dataList = readEncodedDataArray(inp) ?? undefined;
                return { type: 'SET_REQUEST', requestId, sourceNodeId, setName, operation, ...(txnDedupeId !== undefined ? { txnDedupeId } : {}), ...(data !== undefined ? { data } : {}), ...(dataList !== undefined ? { dataList } : {}) };
            }
            case 'SET_RESPONSE':
                return readSetResponse(inp);
            case 'SET_STATE_SYNC':
                return readSetStateSync(inp);
            case 'SET_STATE_ACK':
                return { type: 'SET_STATE_ACK', requestId: readRequiredString(inp), setName: readRequiredString(inp), version: Number(inp.readLong()) };
            case 'SET_EVENT':
                return readSetEvent(inp);
            case 'MULTIMAP_REQUEST': {
                const requestId = readRequiredString(inp);
                const sourceNodeId = readRequiredString(inp);
                const mapName = readRequiredString(inp);
                const operation = readRequiredString(inp);
                const txnDedupeId = inp.readString() ?? undefined;
                const keyData = readOptionalEncodedData(inp) ?? undefined;
                const valueData = readOptionalEncodedData(inp) ?? undefined;
                const dataList = readEncodedDataArray(inp) ?? undefined;
                return { type: 'MULTIMAP_REQUEST', requestId, sourceNodeId, mapName, operation, ...(txnDedupeId !== undefined ? { txnDedupeId } : {}), ...(keyData !== undefined ? { keyData } : {}), ...(valueData !== undefined ? { valueData } : {}), ...(dataList !== undefined ? { dataList } : {}) };
            }
            case 'MULTIMAP_RESPONSE':
                return readMultiMapResponse(inp);
            case 'MULTIMAP_STATE_SYNC':
                return readMultiMapStateSync(inp);
            case 'MULTIMAP_STATE_ACK':
                return { type: 'MULTIMAP_STATE_ACK', requestId: readRequiredString(inp), mapName: readRequiredString(inp), version: Number(inp.readLong()) };
            case 'MULTIMAP_EVENT':
                return readMultiMapEvent(inp);
            case 'REPLICATED_MAP_PUT': {
                const mapName = readRequiredString(inp);
                const version = Number(inp.readLong());
                const sourceNodeId = readRequiredString(inp);
                const keyData = readEncodedData(inp);
                const valueData = readEncodedData(inp);
                return { type: 'REPLICATED_MAP_PUT', mapName, version, sourceNodeId, keyData, valueData };
            }
            case 'REPLICATED_MAP_REMOVE': {
                const mapName = readRequiredString(inp);
                const version = Number(inp.readLong());
                const sourceNodeId = readRequiredString(inp);
                const keyData = readEncodedData(inp);
                return { type: 'REPLICATED_MAP_REMOVE', mapName, version, sourceNodeId, keyData };
            }
            case 'REPLICATED_MAP_CLEAR':
                return { type: 'REPLICATED_MAP_CLEAR', mapName: readRequiredString(inp), version: Number(inp.readLong()), sourceNodeId: readRequiredString(inp) };
            case 'REPLICATED_MAP_STATE_SYNC':
                return readReplicatedMapStateSync(inp);
            case 'REPLICATED_MAP_STATE_ACK':
                return { type: 'REPLICATED_MAP_STATE_ACK', requestId: readRequiredString(inp), mapName: readRequiredString(inp), version: Number(inp.readLong()) };
            case 'TXN_BACKUP_REPLICATION':
                return {
                    type: 'TXN_BACKUP_REPLICATION',
                    requestId: inp.readString() ?? null,
                    sourceNodeId: readRequiredString(inp),
                    payload: readTransactionBackupMessage(inp) as TransactionBackupReplicationMsg['payload'],
                };
            case 'TXN_BACKUP_REPLICATION_ACK':
                return {
                    type: 'TXN_BACKUP_REPLICATION_ACK',
                    requestId: readRequiredString(inp),
                    txnId: readRequiredString(inp),
                    applied: inp.readBoolean(),
                };
            case 'MIGRATION_DATA':
                return readMigrationData(inp);
            case 'MIGRATION_ACK': {
                const migrationId = readRequiredString(inp);
                const success = inp.readBoolean();
                const error = inp.readString() ?? undefined;
                return { type: 'MIGRATION_ACK', migrationId, success, ...(error !== undefined ? { error } : {}) };
            }
            case 'RAFT_PRE_VOTE_REQUEST':
                return {
                    type: 'RAFT_PRE_VOTE_REQUEST',
                    groupId: readRequiredString(inp),
                    candidateId: readRequiredString(inp),
                    nextTerm: inp.readInt(),
                    lastLogTerm: inp.readInt(),
                    lastLogIndex: inp.readInt(),
                };
            case 'RAFT_PRE_VOTE_RESPONSE':
                return {
                    type: 'RAFT_PRE_VOTE_RESPONSE',
                    groupId: readRequiredString(inp),
                    term: inp.readInt(),
                    granted: inp.readBoolean(),
                    voterId: readRequiredString(inp),
                };
            case 'RAFT_VOTE_REQUEST':
                return {
                    type: 'RAFT_VOTE_REQUEST',
                    groupId: readRequiredString(inp),
                    term: inp.readInt(),
                    candidateId: readRequiredString(inp),
                    lastLogTerm: inp.readInt(),
                    lastLogIndex: inp.readInt(),
                };
            case 'RAFT_VOTE_RESPONSE':
                return {
                    type: 'RAFT_VOTE_RESPONSE',
                    groupId: readRequiredString(inp),
                    term: inp.readInt(),
                    voteGranted: inp.readBoolean(),
                    voterId: readRequiredString(inp),
                };
            case 'RAFT_APPEND_REQUEST': {
                const groupId = readRequiredString(inp);
                const term = inp.readInt();
                const leaderId = readRequiredString(inp);
                const prevLogIndex = inp.readInt();
                const prevLogTerm = inp.readInt();
                const entryCount = inp.readInt();
                const entries = new Array(entryCount);
                for (let i = 0; i < entryCount; i++) {
                    const entryTerm = inp.readInt();
                    const entryIndex = inp.readInt();
                    const command = JSON.parse(readRequiredString(inp)) as import('../../cp/raft/types.js').RaftCommand;
                    entries[i] = { term: entryTerm, index: entryIndex, command };
                }
                const leaderCommit = inp.readInt();
                return { type: 'RAFT_APPEND_REQUEST', groupId, term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit };
            }
            case 'RAFT_APPEND_SUCCESS':
                return {
                    type: 'RAFT_APPEND_SUCCESS',
                    groupId: readRequiredString(inp),
                    term: inp.readInt(),
                    followerId: readRequiredString(inp),
                    lastLogIndex: inp.readInt(),
                };
            case 'RAFT_APPEND_FAILURE':
                return {
                    type: 'RAFT_APPEND_FAILURE',
                    groupId: readRequiredString(inp),
                    term: inp.readInt(),
                    followerId: readRequiredString(inp),
                    lastLogIndex: inp.readInt(),
                };
            case 'RAFT_INSTALL_SNAPSHOT': {
                const groupId = readRequiredString(inp);
                const term = inp.readInt();
                const leaderId = readRequiredString(inp);
                const snapshotTerm = inp.readInt();
                const snapshotIndex = inp.readInt();
                const data = inp.readByteArray() ?? Buffer.alloc(0);
                const groupMembersLogIndex = inp.readInt();
                const memberCount = inp.readInt();
                const groupMembers: import('../../cp/raft/types.js').RaftEndpoint[] = new Array(memberCount);
                for (let i = 0; i < memberCount; i++) {
                    const uuid = readRequiredString(inp);
                    const host = readRequiredString(inp);
                    const port = inp.readInt();
                    groupMembers[i] = { uuid, address: { host, port } };
                }
                return {
                    type: 'RAFT_INSTALL_SNAPSHOT',
                    groupId,
                    term,
                    leaderId,
                    snapshot: { term: snapshotTerm, index: snapshotIndex, data, groupMembers, groupMembersLogIndex },
                };
            }
            case 'RAFT_INSTALL_SNAPSHOT_RESPONSE':
                return {
                    type: 'RAFT_INSTALL_SNAPSHOT_RESPONSE',
                    groupId: readRequiredString(inp),
                    term: inp.readInt(),
                    followerId: readRequiredString(inp),
                    success: inp.readBoolean(),
                    lastLogIndex: inp.readInt(),
                };
            case 'RAFT_TRIGGER_ELECTION':
                return {
                    type: 'RAFT_TRIGGER_ELECTION',
                    groupId: readRequiredString(inp),
                };
            case 'WAN_REPLICATION_EVENT_BATCH': {
                const batchId = readRequiredString(inp);
                const sourceClusterName = readRequiredString(inp);
                const eventCount = inp.readInt();
                const events: import('./ClusterMessage.js').WanReplicationEventEntry[] = [];
                for (let i = 0; i < eventCount; i++) {
                    events.push({
                        mapName: readRequiredString(inp),
                        eventType: readRequiredString(inp) as 'PUT' | 'REMOVE' | 'CLEAR',
                        keyData: readOptionalByteArray(inp),
                        valueData: readOptionalByteArray(inp),
                        ttl: Number(inp.readLong()),
                    });
                }
                return { type: 'WAN_REPLICATION_EVENT_BATCH', batchId, sourceClusterName, events };
            }
            case 'WAN_REPLICATION_ACK':
                return {
                    type: 'WAN_REPLICATION_ACK',
                    batchId: readRequiredString(inp),
                    success: inp.readBoolean(),
                    error: inp.readString() ?? undefined,
                };
            case 'WAN_SYNC_REQUEST':
                return {
                    type: 'WAN_SYNC_REQUEST',
                    requestId: readRequiredString(inp),
                    sourceClusterName: readRequiredString(inp),
                    mapName: readRequiredString(inp),
                    fullSync: inp.readBoolean(),
                };
            case 'WAN_SYNC_RESPONSE':
                return {
                    type: 'WAN_SYNC_RESPONSE',
                    requestId: readRequiredString(inp),
                    accepted: inp.readBoolean(),
                    error: inp.readString() ?? undefined,
                };
            case 'WAN_CONSISTENCY_CHECK_REQUEST':
                return {
                    type: 'WAN_CONSISTENCY_CHECK_REQUEST',
                    requestId: readRequiredString(inp),
                    sourceClusterName: readRequiredString(inp),
                    mapName: readRequiredString(inp),
                    merkleRootHex: readRequiredString(inp),
                };
            case 'WAN_CONSISTENCY_CHECK_RESPONSE':
                return {
                    type: 'WAN_CONSISTENCY_CHECK_RESPONSE',
                    requestId: readRequiredString(inp),
                    consistent: inp.readBoolean(),
                    differingLeafCount: inp.readInt(),
                };
        }
        throw new Error(`Unknown message type ID: ${messageTypeId}`);
    }

    private _buildFlags(message: ClusterMessage): number {
        switch (message.type) {
            case 'OPERATION_RESPONSE':
            case 'BACKUP_ACK':
            case 'TOPIC_ACK':
            case 'RELIABLE_TOPIC_PUBLISH_ACK':
            case 'RELIABLE_TOPIC_BACKUP_ACK':
            case 'RINGBUFFER_RESPONSE':
            case 'RINGBUFFER_BACKUP_ACK':
            case 'MEMBERS_VIEW_RESPONSE':
            case 'QUEUE_RESPONSE':
                return FLAG_IS_RESPONSE | (message.type === 'OPERATION_RESPONSE' && message.error !== null ? FLAG_IS_ERROR : 0);
            case 'BACKUP':
            case 'RELIABLE_TOPIC_BACKUP':
            case 'RINGBUFFER_BACKUP':
                return FLAG_IS_BACKUP;
            case 'QUEUE_EVENT':
            case 'LIST_EVENT':
            case 'TOPIC_MESSAGE':
            case 'RELIABLE_TOPIC_MESSAGE':
            case 'BLITZ_TOPOLOGY_ANNOUNCE':
            case 'INVALIDATE':
                return FLAG_IS_EVENT;
            default:
                return 0;
        }
    }

    private _partitionId(message: ClusterMessage): number {
        if ('partitionId' in message && typeof message.partitionId === 'number') {
            return message.partitionId;
        }
        return NO_PARTITION;
    }
}

const DEFAULT_BINARY_SERIALIZATION_STRATEGY = new BinarySerializationStrategy();

export function serializeBinaryClusterMessage(message: ClusterMessage): Uint8Array {
    return DEFAULT_BINARY_SERIALIZATION_STRATEGY.serialize(message);
}

function toBufferView(buffer: Uint8Array): Buffer {
    if (Buffer.isBuffer(buffer)) {
        return buffer;
    }
    return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

// ── Optional byte array helpers ───────────────────────────────────────────────

/**
 * Write an optional Buffer: writes a flag byte (0=absent, 1=present) followed
 * by the byte array when present. Used for WAN event key/value data.
 */
function writeOptionalByteArray(out: ByteArrayObjectDataOutput, buf: Buffer | null): void {
    if (buf === null) {
        out.writeByte(0);
    } else {
        out.writeByte(1);
        out.writeByteArray(buf);
    }
}

/**
 * Read an optional Buffer written by writeOptionalByteArray.
 * Returns null when the absent flag is set.
 */
function readOptionalByteArray(inp: ByteArrayObjectDataInput): Buffer | null {
    const present = inp.readUnsignedByte();
    if (present === 0) return null;
    return inp.readByteArray() ?? Buffer.alloc(0);
}

function writeMembershipMessage(out: ByteArrayObjectDataOutput, message: FinalizeJoinMsg | MembersUpdateMsg): void {
    out.writeInt(message.memberListVersion);
    writeWireMembers(out, message.members);
    writeAddress(out, message.masterAddress);
    out.writeString(message.clusterId);
    out.writeString(message.clusterState ?? null);
}

function readMembershipMessage(inp: ByteArrayObjectDataInput, type: 'FINALIZE_JOIN' | 'MEMBERS_UPDATE'): FinalizeJoinMsg | MembersUpdateMsg {
    return {
        type,
        memberListVersion: inp.readInt(),
        members: readWireMembers(inp),
        masterAddress: readAddress(inp),
        clusterId: readRequiredString(inp),
        clusterState: inp.readString() ?? undefined,
    };
}

function writePartitionState(out: ByteArrayObjectDataOutput, message: PartitionStateMsg): void {
    out.writeString(message.clusterState ?? null);
    out.writeInt(message.versions.length);
    for (const version of message.versions) {
        out.writeLong(BigInt(version));
    }
    out.writeInt(message.partitions.length);
    for (const row of message.partitions) {
        out.writeInt(row.length);
        for (const replica of row) {
            if (replica === null) {
                out.writeBoolean(true);
                continue;
            }
            out.writeBoolean(false);
            writeAddress(out, replica.address);
            out.writeString(replica.uuid);
        }
    }
}

function readPartitionState(inp: ByteArrayObjectDataInput): PartitionStateMsg {
    const clusterState = inp.readString() ?? undefined;
    const versionCount = inp.readInt();
    const versions = new Array<number>(versionCount);
    for (let index = 0; index < versionCount; index++) {
        versions[index] = Number(inp.readLong());
    }
    const partitionCount = inp.readInt();
    const partitions: (WirePartitionReplica | null)[][] = new Array(partitionCount);
    for (let rowIndex = 0; rowIndex < partitionCount; rowIndex++) {
        const replicaCount = inp.readInt();
        const row: (WirePartitionReplica | null)[] = new Array(replicaCount);
        for (let replicaIndex = 0; replicaIndex < replicaCount; replicaIndex++) {
            if (inp.readBoolean()) {
                row[replicaIndex] = null;
                continue;
            }
            row[replicaIndex] = { address: readAddress(inp), uuid: readRequiredString(inp) };
        }
        partitions[rowIndex] = row;
    }
    return { type: 'PARTITION_STATE', clusterState, versions, partitions };
}

function writeTransactionBackupMessage(out: ByteArrayObjectDataOutput, message: TransactionBackupMessage): void {
    out.writeString(message.type);
    out.writeString(message.txnId);
    switch (message.type) {
        case 'TXN_BEGIN':
            out.writeString(message.coordinatorMemberId);
            out.writeString(message.callerUuid);
            out.writeLong(BigInt(message.timeoutMillis));
            out.writeLong(BigInt(message.startTime));
            out.writeBoolean(message.allowedDuringPassiveState);
            out.writeStringArray([...message.backupMemberIds]);
            return;
        case 'TXN_PREPARE':
            out.writeString(message.coordinatorMemberId);
            out.writeString(message.callerUuid);
            out.writeLong(BigInt(message.timeoutMillis));
            out.writeLong(BigInt(message.startTime));
            out.writeBoolean(message.allowedDuringPassiveState);
            out.writeStringArray([...message.backupMemberIds]);
            writeTransactionBackupRecords(out, message.records);
            return;
        case 'TXN_STATE':
            out.writeString(message.state);
            return;
        case 'TXN_RECOVERY_STARTED':
        case 'TXN_RECOVERY_FAILED':
        case 'TXN_RECOVERED':
            out.writeString(message.recoveryMemberId);
            out.writeString(message.recoveryFenceToken);
            return;
        case 'TXN_PURGE':
            out.writeString(message.recoveryMemberId);
            out.writeString(message.recoveryFenceToken);
            return;
    }
}

function readTransactionBackupMessage(inp: ByteArrayObjectDataInput): TransactionBackupMessage {
    const type = readRequiredString(inp) as TransactionBackupMessage['type'];
    const txnId = readRequiredString(inp);
    switch (type) {
        case 'TXN_BEGIN':
            return {
                type,
                txnId,
                coordinatorMemberId: readRequiredString(inp),
                callerUuid: readRequiredString(inp),
                timeoutMillis: Number(inp.readLong()),
                startTime: Number(inp.readLong()),
                allowedDuringPassiveState: inp.readBoolean(),
                backupMemberIds: inp.readStringArray() ?? [],
            };
        case 'TXN_PREPARE':
            return {
                type,
                txnId,
                coordinatorMemberId: readRequiredString(inp),
                callerUuid: readRequiredString(inp),
                timeoutMillis: Number(inp.readLong()),
                startTime: Number(inp.readLong()),
                allowedDuringPassiveState: inp.readBoolean(),
                backupMemberIds: inp.readStringArray() ?? [],
                records: readTransactionBackupRecords(inp),
            };
        case 'TXN_STATE':
            return {
                type,
                txnId,
                state: readRequiredString(inp) as Extract<TransactionBackupMessage, { type: 'TXN_STATE' }>['state'],
            };
        case 'TXN_RECOVERY_STARTED':
        case 'TXN_RECOVERY_FAILED':
        case 'TXN_RECOVERED':
            return {
                type,
                txnId,
                recoveryMemberId: readRequiredString(inp),
                recoveryFenceToken: readRequiredString(inp),
            };
        case 'TXN_PURGE':
            return {
                type,
                txnId,
                recoveryMemberId: inp.readString(),
                recoveryFenceToken: inp.readString(),
            };
    }
    throw new Error(`Unsupported transaction backup message type: ${type}`);
}

function writeTransactionBackupRecords(out: ByteArrayObjectDataOutput, records: readonly TransactionBackupRecord[]): void {
    out.writeInt(records.length);
    for (const record of records) {
        out.writeString(record.recordId);
        out.writeString(record.kind);
        switch (record.kind) {
            case 'map':
                out.writeString(record.mapName);
                out.writeInt(record.partitionId);
                out.writeString(record.entry.opType);
                writeEncodedData(out, record.entry.key);
                writeOptionalEncodedData(out, record.entry.value);
                writeOptionalEncodedData(out, record.entry.oldValue);
                break;
            case 'queue':
                out.writeString(record.queueName);
                out.writeString(record.opType);
                writeOptionalEncodedData(out, record.valueData);
                break;
            case 'list':
                out.writeString(record.listName);
                out.writeString(record.opType);
                writeEncodedData(out, record.valueData);
                break;
            case 'set':
                out.writeString(record.setName);
                out.writeString(record.opType);
                writeEncodedData(out, record.valueData);
                break;
            case 'multimap':
                out.writeString(record.mapName);
                out.writeString(record.opType);
                writeEncodedData(out, record.keyData);
                writeOptionalEncodedData(out, record.valueData);
                break;
        }
    }
}

function readTransactionBackupRecords(inp: ByteArrayObjectDataInput): TransactionBackupRecord[] {
    const count = inp.readInt();
    const records: TransactionBackupRecord[] = new Array(count);
    for (let index = 0; index < count; index++) {
        const recordId = readRequiredString(inp);
        const kind = readRequiredString(inp) as TransactionBackupRecord['kind'];
        switch (kind) {
            case 'map':
                records[index] = {
                    recordId,
                    kind,
                    mapName: readRequiredString(inp),
                    partitionId: inp.readInt(),
                    entry: {
                        opType: readRequiredString(inp) as Extract<TransactionBackupRecord, { kind: 'map' }>['entry']['opType'],
                        key: readEncodedData(inp),
                        value: readOptionalEncodedData(inp),
                        oldValue: readOptionalEncodedData(inp),
                    },
                };
                break;
            case 'queue':
                records[index] = {
                    recordId,
                    kind,
                    queueName: readRequiredString(inp),
                    opType: readRequiredString(inp) as Extract<TransactionBackupRecord, { kind: 'queue' }>['opType'],
                    valueData: readOptionalEncodedData(inp),
                };
                break;
            case 'list':
                records[index] = {
                    recordId,
                    kind,
                    listName: readRequiredString(inp),
                    opType: readRequiredString(inp) as Extract<TransactionBackupRecord, { kind: 'list' }>['opType'],
                    valueData: readEncodedData(inp),
                };
                break;
            case 'set':
                records[index] = {
                    recordId,
                    kind,
                    setName: readRequiredString(inp),
                    opType: readRequiredString(inp) as Extract<TransactionBackupRecord, { kind: 'set' }>['opType'],
                    valueData: readEncodedData(inp),
                };
                break;
            case 'multimap':
                records[index] = {
                    recordId,
                    kind,
                    mapName: readRequiredString(inp),
                    opType: readRequiredString(inp) as Extract<TransactionBackupRecord, { kind: 'multimap' }>['opType'],
                    keyData: readEncodedData(inp),
                    valueData: readOptionalEncodedData(inp),
                };
                break;
        }
    }
    return records;
}

function writeOperationMessage(out: ByteArrayObjectDataOutput, message: OperationMsg): void {
    out.writeLong(BigInt(message.callId));
    out.writeString(message.senderId);
    out.writeShort(message.factoryId);
    out.writeShort(message.classId);
    out.writeByteArray(message.payload);
}

function writeBackupMessage(out: ByteArrayObjectDataOutput, message: BackupMsg): void {
    out.writeLong(BigInt(message.callId));
    out.writeInt(message.replicaIndex);
    out.writeString(message.senderId);
    out.writeString(message.callerId);
    out.writeBoolean(message.sync);
    writeLongStringArray(out, message.replicaVersions);
    out.writeShort(message.factoryId);
    out.writeShort(message.classId);
    out.writeByteArray(message.payload);
}

function writeRecoverySyncResponse(out: ByteArrayObjectDataOutput, message: RecoverySyncResponseMsg): void {
    out.writeString(message.requestId);
    out.writeInt(message.partitionId);
    out.writeInt(message.replicaIndex);
    out.writeInt(message.chunkIndex);
    out.writeInt(message.chunkCount);
    writeLongStringArray(out, message.versions);
    writeStringArrayMap(out, message.namespaceVersions);
    out.writeInt(message.namespaceStates.length);
    for (const state of message.namespaceStates) {
        out.writeString(state.namespace);
        out.writeLong(BigInt(state.estimatedSizeBytes));
        out.writeInt(state.entries.length);
        for (const [key, value] of state.entries) {
            writeEncodedData(out, key);
            writeEncodedData(out, value);
        }
    }
}

function readRecoverySyncResponse(inp: ByteArrayObjectDataInput): RecoverySyncResponseMsg {
    const requestId = readRequiredString(inp);
    const partitionId = inp.readInt();
    const replicaIndex = inp.readInt();
    const chunkIndex = inp.readInt();
    const chunkCount = inp.readInt();
    const versions = readLongStringArray(inp);
    const namespaceVersions = readStringArrayMap(inp);
    const namespaceStateCount = inp.readInt();
    const namespaceStates = new Array<RecoverySyncResponseMsg['namespaceStates'][number]>(namespaceStateCount);
    for (let index = 0; index < namespaceStateCount; index++) {
        const namespace = readRequiredString(inp);
        const estimatedSizeBytes = Number(inp.readLong());
        const entryCount = inp.readInt();
        const entries: [EncodedData, EncodedData][] = new Array(entryCount);
        for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
            entries[entryIndex] = [readEncodedData(inp), readEncodedData(inp)] as const;
        }
        namespaceStates[index] = { namespace, estimatedSizeBytes, entries };
    }
    return {
        type: 'RECOVERY_SYNC_RESPONSE',
        requestId,
        partitionId,
        replicaIndex,
        chunkIndex,
        chunkCount,
        versions,
        namespaceVersions,
        namespaceStates,
    };
}

function writeQueueResponse(out: ByteArrayObjectDataOutput, message: QueueResponseMsg): void {
    out.writeString(message.requestId);
    out.writeBoolean(message.success);
    out.writeString(message.resultType);
    out.writeBoolean(message.booleanResult ?? false);
    out.writeLong(BigInt(message.numberResult ?? 0));
    writeOptionalEncodedData(out, message.data ?? null);
    writeEncodedDataArray(out, message.dataList ?? []);
    out.writeString(message.error ?? null);
}

function readQueueResponse(inp: ByteArrayObjectDataInput): QueueResponseMsg {
    const requestId = readRequiredString(inp);
    const success = inp.readBoolean();
    const resultType = readRequiredString(inp) as QueueResponseMsg['resultType'];
    const booleanResult = inp.readBoolean();
    const numberResult = Number(inp.readLong());
    const data = readOptionalEncodedData(inp) ?? undefined;
    const dataList = readEncodedDataArray(inp) ?? undefined;
    const error = inp.readString() ?? undefined;

    return {
        type: 'QUEUE_RESPONSE',
        requestId,
        success,
        resultType,
        ...(resultType === 'boolean' ? { booleanResult } : {}),
        ...(resultType === 'number' ? { numberResult } : {}),
        ...(resultType === 'data' && data !== undefined ? { data } : {}),
        ...(resultType === 'data-array' && dataList !== undefined ? { dataList } : {}),
        ...(error !== undefined ? { error } : {}),
    };
}

function writeQueueStateSync(out: ByteArrayObjectDataOutput, message: QueueStateSyncMsg): void {
    out.writeString(message.requestId);
    out.writeString(message.sourceNodeId);
    out.writeString(message.queueName);
    out.writeLong(BigInt(message.version));
    out.writeLong(BigInt(message.nextItemId));
    out.writeInt(message.items.length);
    for (const item of message.items) {
        out.writeLong(BigInt(item.itemId));
        out.writeLong(BigInt(item.enqueuedAt));
        writeEncodedData(out, item.data);
    }
    out.writeString(message.ownerNodeId);
    out.writeStringArray(message.appliedTxnOpIds);
    out.writeLong(BigInt(message.counters.offerOperationCount));
    out.writeLong(BigInt(message.counters.rejectedOfferOperationCount));
    out.writeLong(BigInt(message.counters.pollOperationCount));
    out.writeLong(BigInt(message.counters.emptyPollOperationCount));
    out.writeLong(BigInt(message.counters.otherOperationCount));
    out.writeLong(BigInt(message.counters.eventOperationCount));
}

function readQueueStateSync(inp: ByteArrayObjectDataInput): QueueStateSyncMsg {
    const requestId = inp.readString();
    const sourceNodeId = readRequiredString(inp);
    const queueName = readRequiredString(inp);
    const version = Number(inp.readLong());
    const nextItemId = Number(inp.readLong());
    const itemCount = inp.readInt();
    const items = new Array<QueueStateSyncMsg['items'][number]>(itemCount);
    for (let index = 0; index < itemCount; index++) {
        items[index] = { itemId: Number(inp.readLong()), enqueuedAt: Number(inp.readLong()), data: readEncodedData(inp) };
    }
    return {
        type: 'QUEUE_STATE_SYNC',
        requestId,
        sourceNodeId,
        queueName,
        version,
        nextItemId,
        items,
        ownerNodeId: readRequiredString(inp),
        appliedTxnOpIds: inp.readStringArray() ?? [],
        counters: {
            offerOperationCount: Number(inp.readLong()),
            rejectedOfferOperationCount: Number(inp.readLong()),
            pollOperationCount: Number(inp.readLong()),
            emptyPollOperationCount: Number(inp.readLong()),
            otherOperationCount: Number(inp.readLong()),
            eventOperationCount: Number(inp.readLong()),
        },
    };
}

function writeQueueEvent(out: ByteArrayObjectDataOutput, message: QueueEventMsg): void {
    out.writeString(message.queueName);
    out.writeString(message.eventType);
    out.writeString(message.sourceNodeId);
    writeOptionalEncodedData(out, message.data);
}

function readQueueEvent(inp: ByteArrayObjectDataInput): QueueEventMsg {
    return {
        type: 'QUEUE_EVENT',
        queueName: readRequiredString(inp),
        eventType: readRequiredString(inp) as QueueEventMsg['eventType'],
        sourceNodeId: readRequiredString(inp),
        data: readOptionalEncodedData(inp),
    };
}

function writeRingbufferResponse(out: ByteArrayObjectDataOutput, message: RingbufferResponseMsg): void {
    out.writeString(message.requestId);
    out.writeBoolean(message.success);
    out.writeString(message.resultType);
    out.writeLong(BigInt(message.numberResult ?? 0));
    writeOptionalEncodedData(out, message.data ?? null);
    writeEncodedDataArray(out, message.dataList ?? []);
    out.writeString(message.error ?? null);
}

function readRingbufferResponse(inp: ByteArrayObjectDataInput): RingbufferResponseMsg {
    const requestId = readRequiredString(inp);
    const success = inp.readBoolean();
    const resultType = readRequiredString(inp) as RingbufferResponseMsg['resultType'];
    const numberResult = Number(inp.readLong());
    const data = readOptionalEncodedData(inp) ?? undefined;
    const dataList = readEncodedDataArray(inp) ?? undefined;
    const error = inp.readString() ?? undefined;

    return {
        type: 'RINGBUFFER_RESPONSE',
        requestId,
        success,
        resultType,
        ...(resultType === 'number' ? { numberResult } : {}),
        ...(resultType === 'data' && data !== undefined ? { data } : {}),
        ...(resultType === 'data-array' && dataList !== undefined ? { dataList } : {}),
        ...(error !== undefined ? { error } : {}),
    };
}

function writeRingbufferBackup(out: ByteArrayObjectDataOutput, message: RingbufferBackupMsg): void {
    out.writeString(message.requestId);
    out.writeString(message.sourceNodeId);
    out.writeString(message.rbName);
    out.writeLong(BigInt(message.headSequence));
    out.writeLong(BigInt(message.tailSequence));
    out.writeInt(message.items.length);
    for (const item of message.items) {
        out.writeLong(BigInt(item.sequence));
        writeEncodedData(out, item.data);
    }
}

function readRingbufferBackup(inp: ByteArrayObjectDataInput): RingbufferBackupMsg {
    const requestId = inp.readString();
    const sourceNodeId = readRequiredString(inp);
    const rbName = readRequiredString(inp);
    const headSequence = Number(inp.readLong());
    const tailSequence = Number(inp.readLong());
    const itemCount = inp.readInt();
    const items = new Array<RingbufferBackupMsg['items'][number]>(itemCount);
    for (let index = 0; index < itemCount; index++) {
        items[index] = { sequence: Number(inp.readLong()), data: readEncodedData(inp) };
    }
    return {
        type: 'RINGBUFFER_BACKUP',
        requestId,
        sourceNodeId,
        rbName,
        headSequence,
        tailSequence,
        items,
    };
}

function writeListEvent(out: ByteArrayObjectDataOutput, message: ListEventMsg): void {
    out.writeString(message.listName);
    out.writeString(message.eventType);
    out.writeString(message.sourceNodeId);
    writeOptionalEncodedData(out, message.data);
}

function readListEvent(inp: ByteArrayObjectDataInput): ListEventMsg {
    return {
        type: 'LIST_EVENT',
        listName: readRequiredString(inp),
        eventType: readRequiredString(inp) as ListEventMsg['eventType'],
        sourceNodeId: readRequiredString(inp),
        data: readOptionalEncodedData(inp),
    };
}

function writeSetEvent(out: ByteArrayObjectDataOutput, message: SetEventMsg): void {
    out.writeString(message.setName);
    out.writeString(message.eventType);
    out.writeString(message.sourceNodeId);
    writeOptionalEncodedData(out, message.data);
}

function readSetEvent(inp: ByteArrayObjectDataInput): SetEventMsg {
    return {
        type: 'SET_EVENT',
        setName: readRequiredString(inp),
        eventType: readRequiredString(inp) as SetEventMsg['eventType'],
        sourceNodeId: readRequiredString(inp),
        data: readOptionalEncodedData(inp),
    };
}

function writeMultiMapEvent(out: ByteArrayObjectDataOutput, message: MultiMapEventMsg): void {
    out.writeString(message.mapName);
    out.writeString(message.eventType);
    out.writeString(message.sourceNodeId);
    writeOptionalEncodedData(out, message.keyData);
    writeOptionalEncodedData(out, message.valueData);
    writeOptionalEncodedData(out, message.oldValueData);
    out.writeInt(message.numberOfAffectedEntries);
}

function readMultiMapEvent(inp: ByteArrayObjectDataInput): MultiMapEventMsg {
    return {
        type: 'MULTIMAP_EVENT',
        mapName: readRequiredString(inp),
        eventType: readRequiredString(inp) as MultiMapEventMsg['eventType'],
        sourceNodeId: readRequiredString(inp),
        keyData: readOptionalEncodedData(inp),
        valueData: readOptionalEncodedData(inp),
        oldValueData: readOptionalEncodedData(inp),
        numberOfAffectedEntries: inp.readInt(),
    };
}

function writeReliableTopicMessage(out: ByteArrayObjectDataOutput, message: ReliableTopicMessageMsg): void {
    out.writeString(message.topicName);
    out.writeLong(BigInt(message.sequence));
    out.writeLong(BigInt(message.publishTime));
    out.writeString(message.publisherAddress);
    writeEncodedData(out, message.data);
}

function readReliableTopicMessage(inp: ByteArrayObjectDataInput): ReliableTopicMessageMsg {
    return {
        type: 'RELIABLE_TOPIC_MESSAGE',
        topicName: readRequiredString(inp),
        sequence: Number(inp.readLong()),
        publishTime: Number(inp.readLong()),
        publisherAddress: inp.readString(),
        data: readEncodedData(inp),
    };
}

function writeReliableTopicBackup(out: ByteArrayObjectDataOutput, message: ReliableTopicBackupMsg): void {
    out.writeString(message.requestId);
    out.writeString(message.topicName);
    out.writeLong(BigInt(message.sequence));
    out.writeLong(BigInt(message.publishTime));
    out.writeString(message.publisherAddress);
    writeEncodedData(out, message.data);
    out.writeString(message.sourceNodeId);
}

function readReliableTopicBackup(inp: ByteArrayObjectDataInput): ReliableTopicBackupMsg {
    return {
        type: 'RELIABLE_TOPIC_BACKUP',
        requestId: inp.readString(),
        topicName: readRequiredString(inp),
        sequence: Number(inp.readLong()),
        publishTime: Number(inp.readLong()),
        publisherAddress: inp.readString(),
        data: readEncodedData(inp),
        sourceNodeId: readRequiredString(inp),
    };
}

function writeBlitzRegistration(out: ByteArrayObjectDataOutput, message: BlitzNodeRegisterMsg): void {
    const registration = message.registration;
    out.writeString(registration.memberId);
    out.writeInt(registration.memberListVersion);
    out.writeString(registration.serverName);
    out.writeInt(registration.clientPort);
    out.writeInt(registration.clusterPort);
    out.writeString(registration.advertiseHost);
    out.writeString(registration.clusterName);
    out.writeBoolean(registration.ready);
    out.writeLong(BigInt(registration.startedAt));
}

function readBlitzRegistration(inp: ByteArrayObjectDataInput): BlitzNodeRegisterMsg {
    return {
        type: 'BLITZ_NODE_REGISTER',
        registration: {
            memberId: readRequiredString(inp),
            memberListVersion: inp.readInt(),
            serverName: readRequiredString(inp),
            clientPort: inp.readInt(),
            clusterPort: inp.readInt(),
            advertiseHost: readRequiredString(inp),
            clusterName: readRequiredString(inp),
            ready: inp.readBoolean(),
            startedAt: Number(inp.readLong()),
        },
    };
}

function writeBlitzTopologyResponse(out: ByteArrayObjectDataOutput, message: BlitzTopologyResponseMsg): void {
    out.writeString(message.requestId);
    out.writeStringArray(message.routes);
    out.writeString(message.masterMemberId);
    out.writeInt(message.memberListVersion);
    out.writeString(message.fenceToken);
    out.writeBoolean(message.registrationsComplete);
    out.writeLong(BigInt(message.retryAfterMs ?? -1));
    out.writeString(message.clientConnectUrl);
}

function readBlitzTopologyResponse(inp: ByteArrayObjectDataInput): BlitzTopologyResponseMsg {
    return {
        type: 'BLITZ_TOPOLOGY_RESPONSE',
        requestId: readRequiredString(inp),
        routes: inp.readStringArray() ?? [],
        masterMemberId: readRequiredString(inp),
        memberListVersion: inp.readInt(),
        fenceToken: readRequiredString(inp),
        registrationsComplete: inp.readBoolean(),
        retryAfterMs: readMinusOneAsUndefined(inp),
        clientConnectUrl: readRequiredString(inp),
    };
}

function writeAddress(out: ByteArrayObjectDataOutput, address: { host: string; port: number }): void {
    out.writeString(address.host);
    out.writeInt(address.port);
}

function readAddress(inp: ByteArrayObjectDataInput): { host: string; port: number } {
    return { host: readRequiredString(inp), port: inp.readInt() };
}

function writeMemberVersion(out: ByteArrayObjectDataOutput, version: { major: number; minor: number; patch: number }): void {
    out.writeInt(version.major);
    out.writeInt(version.minor);
    out.writeInt(version.patch);
}

function readMemberVersion(inp: ByteArrayObjectDataInput): { major: number; minor: number; patch: number } {
    return { major: inp.readInt(), minor: inp.readInt(), patch: inp.readInt() };
}

function writeWireMembers(out: ByteArrayObjectDataOutput, members: readonly WireMemberInfo[]): void {
    out.writeInt(members.length);
    for (const member of members) {
        writeAddress(out, member.address);
        out.writeString(member.uuid);
        writeStringMap(out, member.attributes);
        out.writeBoolean(member.liteMember);
        writeMemberVersion(out, member.version);
        out.writeInt(member.memberListJoinVersion);
        writeOptionalAddress(out, member.clientEndpoint);
        writeOptionalAddress(out, member.restEndpoint);
    }
}

function readWireMembers(inp: ByteArrayObjectDataInput): WireMemberInfo[] {
    const count = inp.readInt();
    const members = new Array<WireMemberInfo>(count);
    for (let index = 0; index < count; index++) {
        members[index] = {
            address: readAddress(inp),
            uuid: readRequiredString(inp),
            attributes: readStringMap(inp),
            liteMember: inp.readBoolean(),
            version: readMemberVersion(inp),
            memberListJoinVersion: inp.readInt(),
            clientEndpoint: readOptionalAddress(inp),
            restEndpoint: readOptionalAddress(inp),
        };
    }
    return members;
}

function writeOptionalAddress(
    out: ByteArrayObjectDataOutput,
    address: { host: string; port: number } | null,
): void {
    out.writeBoolean(address !== null);
    if (address !== null) {
        writeAddress(out, address);
    }
}

function readOptionalAddress(
    inp: ByteArrayObjectDataInput,
): { host: string; port: number } | null {
    return inp.readBoolean() ? readAddress(inp) : null;
}

function writeEncodedData(out: ByteArrayObjectDataOutput, data: EncodedData): void {
    out.writeByteArray(data.bytes);
}

function readEncodedData(inp: ByteArrayObjectDataInput): EncodedData {
    return { bytes: inp.readByteArray() ?? Buffer.alloc(0) };
}

function writeOptionalEncodedData(out: ByteArrayObjectDataOutput, data: EncodedData | null): void {
    out.writeBoolean(data !== null);
    if (data !== null) {
        writeEncodedData(out, data);
    }
}

function readOptionalEncodedData(inp: ByteArrayObjectDataInput): EncodedData | null {
    return inp.readBoolean() ? readEncodedData(inp) : null;
}

function writeEncodedDataArray(out: ByteArrayObjectDataOutput, values: readonly EncodedData[] | null): void {
    if (values === null) {
        out.writeInt(-1);
        return;
    }
    out.writeInt(values.length);
    for (const value of values) {
        writeEncodedData(out, value);
    }
}

function readEncodedDataArray(inp: ByteArrayObjectDataInput): EncodedData[] | null {
    const count = inp.readInt();
    if (count === -1) {
        return null;
    }
    const values = new Array<EncodedData>(count);
    for (let index = 0; index < count; index++) {
        values[index] = readEncodedData(inp);
    }
    return values;
}

function writeUnknownValue(out: ByteArrayObjectDataOutput, value: unknown): void {
    out.writeString(JSON.stringify(value));
}

function readUnknownValue(inp: ByteArrayObjectDataInput): unknown {
    const encoded = readRequiredString(inp);
    return JSON.parse(encoded) as unknown;
}

function writeStringMap(out: ByteArrayObjectDataOutput, map: Record<string, string>): void {
    const entries = Object.entries(map);
    out.writeInt(entries.length);
    for (const [key, value] of entries) {
        out.writeString(key);
        out.writeString(value);
    }
}

function readStringMap(inp: ByteArrayObjectDataInput): Record<string, string> {
    const count = inp.readInt();
    const result: Record<string, string> = {};
    for (let index = 0; index < count; index++) {
        result[readRequiredString(inp)] = readRequiredString(inp);
    }
    return result;
}

function writeStringArrayMap(out: ByteArrayObjectDataOutput, map: Record<string, string[]>): void {
    const entries = Object.entries(map);
    out.writeInt(entries.length);
    for (const [key, values] of entries) {
        out.writeString(key);
        out.writeStringArray(values);
    }
}

function readStringArrayMap(inp: ByteArrayObjectDataInput): Record<string, string[]> {
    const count = inp.readInt();
    const result: Record<string, string[]> = {};
    for (let index = 0; index < count; index++) {
        result[readRequiredString(inp)] = inp.readStringArray() ?? [];
    }
    return result;
}

function writeLongStringArray(out: ByteArrayObjectDataOutput, values: readonly string[]): void {
    out.writeInt(values.length);
    for (const value of values) {
        out.writeLong(BigInt(value));
    }
}

function readLongStringArray(inp: ByteArrayObjectDataInput, countOffset?: number): string[] {
    const count = countOffset === undefined ? inp.readInt() : inp.readInt(countOffset);
    const values = new Array<string>(count);
    for (let index = 0; index < count; index++) {
        values[index] = inp.readLong().toString();
    }
    return values;
}

function readRequiredString(inp: ByteArrayObjectDataInput): string {
    const value = inp.readString();
    if (value === null) {
        throw new Error('Expected string value');
    }
    return value;
}

function readMinusOneAsUndefined(inp: ByteArrayObjectDataInput): number | undefined {
    const value = Number(inp.readLong());
    return value === -1 ? undefined : value;
}

function readIntMinusOneAsUndefined(inp: ByteArrayObjectDataInput): number | undefined {
    const value = inp.readInt();
    return value === -1 ? undefined : value;
}

function readMinusOneAsNull(inp: ByteArrayObjectDataInput): number | null {
    const value = Number(inp.readLong());
    return value === -1 ? null : value;
}

// ── List helpers ──────────────────────────────────────────────────────

function writeListResponse(out: ByteArrayObjectDataOutput, message: ListResponseMsg): void {
    out.writeString(message.requestId);
    out.writeBoolean(message.success);
    out.writeString(message.resultType);
    out.writeBoolean(message.booleanResult ?? false);
    out.writeLong(BigInt(message.numberResult ?? 0));
    writeOptionalEncodedData(out, message.data ?? null);
    writeEncodedDataArray(out, message.dataList ?? null);
    out.writeString(message.error ?? null);
}

function readListResponse(inp: ByteArrayObjectDataInput): ListResponseMsg {
    const requestId = readRequiredString(inp);
    const success = inp.readBoolean();
    const resultType = readRequiredString(inp) as ListResponseMsg['resultType'];
    const booleanResult = inp.readBoolean();
    const numberResult = Number(inp.readLong());
    const data = readOptionalEncodedData(inp) ?? undefined;
    const dataList = readEncodedDataArray(inp) ?? undefined;
    const error = inp.readString() ?? undefined;
    return {
        type: 'LIST_RESPONSE',
        requestId,
        success,
        resultType,
        ...(resultType === 'boolean' ? { booleanResult } : {}),
        ...(resultType === 'number' ? { numberResult } : {}),
        ...(resultType === 'data' && data !== undefined ? { data } : {}),
        ...(resultType === 'data-array' && dataList !== undefined ? { dataList } : {}),
        ...(error !== undefined ? { error } : {}),
    };
}

function writeListStateSync(out: ByteArrayObjectDataOutput, message: ListStateSyncMsg): void {
    out.writeString(message.requestId);
    out.writeString(message.sourceNodeId);
    out.writeString(message.listName);
    out.writeLong(BigInt(message.version));
    writeEncodedDataArray(out, message.items);
    out.writeStringArray(message.appliedTxnOpIds);
}

function readListStateSync(inp: ByteArrayObjectDataInput): ListStateSyncMsg {
    return {
        type: 'LIST_STATE_SYNC',
        requestId: inp.readString(),
        sourceNodeId: readRequiredString(inp),
        listName: readRequiredString(inp),
        version: Number(inp.readLong()),
        items: readEncodedDataArray(inp) ?? [],
        appliedTxnOpIds: inp.readStringArray() ?? [],
    };
}

// ── Set helpers ───────────────────────────────────────────────────────

function writeSetResponse(out: ByteArrayObjectDataOutput, message: SetResponseMsg): void {
    out.writeString(message.requestId);
    out.writeBoolean(message.success);
    out.writeString(message.resultType);
    out.writeBoolean(message.booleanResult ?? false);
    out.writeLong(BigInt(message.numberResult ?? 0));
    writeEncodedDataArray(out, message.dataList ?? null);
    out.writeString(message.error ?? null);
}

function readSetResponse(inp: ByteArrayObjectDataInput): SetResponseMsg {
    const requestId = readRequiredString(inp);
    const success = inp.readBoolean();
    const resultType = readRequiredString(inp) as SetResponseMsg['resultType'];
    const booleanResult = inp.readBoolean();
    const numberResult = Number(inp.readLong());
    const dataList = readEncodedDataArray(inp) ?? undefined;
    const error = inp.readString() ?? undefined;
    return {
        type: 'SET_RESPONSE',
        requestId,
        success,
        resultType,
        ...(resultType === 'boolean' ? { booleanResult } : {}),
        ...(resultType === 'number' ? { numberResult } : {}),
        ...(resultType === 'data-array' && dataList !== undefined ? { dataList } : {}),
        ...(error !== undefined ? { error } : {}),
    };
}

function writeSetStateSync(out: ByteArrayObjectDataOutput, message: SetStateSyncMsg): void {
    out.writeString(message.requestId);
    out.writeString(message.sourceNodeId);
    out.writeString(message.setName);
    out.writeLong(BigInt(message.version));
    writeEncodedDataArray(out, message.items);
    out.writeStringArray(message.appliedTxnOpIds);
}

function readSetStateSync(inp: ByteArrayObjectDataInput): SetStateSyncMsg {
    return {
        type: 'SET_STATE_SYNC',
        requestId: inp.readString(),
        sourceNodeId: readRequiredString(inp),
        setName: readRequiredString(inp),
        version: Number(inp.readLong()),
        items: readEncodedDataArray(inp) ?? [],
        appliedTxnOpIds: inp.readStringArray() ?? [],
    };
}

// ── MultiMap helpers ──────────────────────────────────────────────────

function writeMultiMapResponse(out: ByteArrayObjectDataOutput, message: MultiMapResponseMsg): void {
    out.writeString(message.requestId);
    out.writeBoolean(message.success);
    out.writeString(message.resultType);
    out.writeBoolean(message.booleanResult ?? false);
    out.writeLong(BigInt(message.numberResult ?? 0));
    writeEncodedDataArray(out, message.dataList ?? null);
    // entry-set: array of [EncodedData, EncodedData] pairs
    const entrySet = message.entrySet ?? null;
    if (entrySet === null) {
        out.writeInt(-1);
    } else {
        out.writeInt(entrySet.length);
        for (const [k, v] of entrySet) {
            writeEncodedData(out, k);
            writeEncodedData(out, v);
        }
    }
    out.writeString(message.error ?? null);
}

function readMultiMapResponse(inp: ByteArrayObjectDataInput): MultiMapResponseMsg {
    const requestId = readRequiredString(inp);
    const success = inp.readBoolean();
    const resultType = readRequiredString(inp) as MultiMapResponseMsg['resultType'];
    const booleanResult = inp.readBoolean();
    const numberResult = Number(inp.readLong());
    const dataList = readEncodedDataArray(inp) ?? undefined;
    const entrySetCount = inp.readInt();
    let entrySet: Array<[import('@zenystx/helios-core/cluster/tcp/DataWireCodec').EncodedData, import('@zenystx/helios-core/cluster/tcp/DataWireCodec').EncodedData]> | undefined;
    if (entrySetCount !== -1) {
        entrySet = new Array(entrySetCount);
        for (let i = 0; i < entrySetCount; i++) {
            entrySet[i] = [readEncodedData(inp), readEncodedData(inp)];
        }
    }
    const error = inp.readString() ?? undefined;
    return {
        type: 'MULTIMAP_RESPONSE',
        requestId,
        success,
        resultType,
        ...(resultType === 'boolean' ? { booleanResult } : {}),
        ...(resultType === 'number' ? { numberResult } : {}),
        ...(resultType === 'data-array' && dataList !== undefined ? { dataList } : {}),
        ...(resultType === 'entry-set' && entrySet !== undefined ? { entrySet } : {}),
        ...(error !== undefined ? { error } : {}),
    };
}

function writeMultiMapStateSync(out: ByteArrayObjectDataOutput, message: MultiMapStateSyncMsg): void {
    out.writeString(message.requestId);
    out.writeString(message.sourceNodeId);
    out.writeString(message.mapName);
    out.writeLong(BigInt(message.version));
    out.writeString(message.valueCollectionType);
    out.writeStringArray(message.appliedTxnOpIds);
    out.writeInt(message.entries.length);
    for (const [key, values] of message.entries) {
        writeEncodedData(out, key);
        writeEncodedDataArray(out, values);
    }
}

function readMultiMapStateSync(inp: ByteArrayObjectDataInput): MultiMapStateSyncMsg {
    const requestId = inp.readString();
    const sourceNodeId = readRequiredString(inp);
    const mapName = readRequiredString(inp);
    const version = Number(inp.readLong());
    const valueCollectionType = readRequiredString(inp) as 'SET' | 'LIST';
    const appliedTxnOpIds = inp.readStringArray() ?? [];
    const entryCount = inp.readInt();
    const entries: Array<[import('@zenystx/helios-core/cluster/tcp/DataWireCodec').EncodedData, import('@zenystx/helios-core/cluster/tcp/DataWireCodec').EncodedData[]]> = new Array(entryCount);
    for (let i = 0; i < entryCount; i++) {
        const key = readEncodedData(inp);
        const values = readEncodedDataArray(inp) ?? [];
        entries[i] = [key, values];
    }
    return { type: 'MULTIMAP_STATE_SYNC', requestId, sourceNodeId, mapName, version, valueCollectionType, appliedTxnOpIds, entries };
}

// ── ReplicatedMap helpers ─────────────────────────────────────────────

function writeReplicatedMapStateSync(out: ByteArrayObjectDataOutput, message: ReplicatedMapStateSyncMsg): void {
    out.writeString(message.requestId);
    out.writeString(message.sourceNodeId);
    out.writeString(message.mapName);
    out.writeLong(BigInt(message.version));
    out.writeInt(message.entries.length);
    for (const [key, value] of message.entries) {
        writeEncodedData(out, key);
        writeEncodedData(out, value);
    }
}

function readReplicatedMapStateSync(inp: ByteArrayObjectDataInput): ReplicatedMapStateSyncMsg {
    const requestId = inp.readString();
    const sourceNodeId = readRequiredString(inp);
    const mapName = readRequiredString(inp);
    const version = Number(inp.readLong());
    const entryCount = inp.readInt();
    const entries: Array<[import('@zenystx/helios-core/cluster/tcp/DataWireCodec').EncodedData, import('@zenystx/helios-core/cluster/tcp/DataWireCodec').EncodedData]> = new Array(entryCount);
    for (let i = 0; i < entryCount; i++) {
        entries[i] = [readEncodedData(inp), readEncodedData(inp)];
    }
    return { type: 'REPLICATED_MAP_STATE_SYNC', requestId, sourceNodeId, mapName, version, entries };
}

// ── Migration data helpers ─────────────────────────────────────────────

function writeMigrationData(out: ByteArrayObjectDataOutput, message: MigrationDataMsg): void {
    out.writeString(message.migrationId);
    out.writeInt(message.partitionId);
    out.writeString(message.senderNodeId);
    out.writeInt(message.namespaces.length);
    for (const ns of message.namespaces) {
        out.writeString(ns.namespace);
        out.writeInt(ns.entries.length);
        for (const entry of ns.entries) {
            out.writeByteArray(entry.key);
            out.writeByteArray(entry.value);
        }
    }
}

function readMigrationData(inp: ByteArrayObjectDataInput): MigrationDataMsg {
    const migrationId = readRequiredString(inp);
    const partitionId = inp.readInt();
    const senderNodeId = readRequiredString(inp);
    const namespaceCount = inp.readInt();
    const namespaces: MigrationDataMsg['namespaces'][number][] = new Array(namespaceCount);
    for (let i = 0; i < namespaceCount; i++) {
        const namespace = readRequiredString(inp);
        const entryCount = inp.readInt();
        const entries = new Array<MigrationDataMsg['namespaces'][number]['entries'][number]>(entryCount);
        for (let j = 0; j < entryCount; j++) {
            entries[j] = {
                key: inp.readByteArray() ?? Buffer.alloc(0),
                value: inp.readByteArray() ?? Buffer.alloc(0),
            };
        }
        namespaces[i] = { namespace, entries };
    }
    return { type: 'MIGRATION_DATA', migrationId, partitionId, senderNodeId, namespaces };
}
