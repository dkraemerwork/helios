import { BinarySerializationStrategy } from '@zenystx/helios-core/cluster/tcp/BinarySerializationStrategy';
import type { ClusterMessage } from '@zenystx/helios-core/cluster/tcp/ClusterMessage';
import { encodeData } from '@zenystx/helios-core/cluster/tcp/DataWireCodec';
import type { ExecutorOperationResult } from '@zenystx/helios-core/executor/ExecutorOperationResult';
import { CancellationOperation } from '@zenystx/helios-core/executor/impl/CancellationOperation';
import { ExecuteCallableOperation } from '@zenystx/helios-core/executor/impl/ExecuteCallableOperation';
import { MemberCallableOperation } from '@zenystx/helios-core/executor/impl/MemberCallableOperation';
import { ShutdownOperation } from '@zenystx/helios-core/executor/impl/ShutdownOperation';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import { ByteArrayObjectDataOutput } from '@zenystx/helios-core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { ClearOperation } from '@zenystx/helios-core/map/impl/operation/ClearOperation';
import { DeleteOperation } from '@zenystx/helios-core/map/impl/operation/DeleteOperation';
import { ExternalStoreClearOperation } from '@zenystx/helios-core/map/impl/operation/ExternalStoreClearOperation';
import { GetOperation } from '@zenystx/helios-core/map/impl/operation/GetOperation';
import { PutBackupOperation } from '@zenystx/helios-core/map/impl/operation/PutBackupOperation';
import { PutIfAbsentOperation } from '@zenystx/helios-core/map/impl/operation/PutIfAbsentOperation';
import { PutOperation } from '@zenystx/helios-core/map/impl/operation/PutOperation';
import { RemoveBackupOperation } from '@zenystx/helios-core/map/impl/operation/RemoveBackupOperation';
import { RemoveOperation } from '@zenystx/helios-core/map/impl/operation/RemoveOperation';
import { SetOperation } from '@zenystx/helios-core/map/impl/operation/SetOperation';
import { decodeResponsePayload, encodeResponsePayload, serializeOperation, deserializeOperation } from '@zenystx/helios-core/spi/impl/operationservice/OperationWireCodec';
import { describe, expect, it } from 'bun:test';

const strategy = new BinarySerializationStrategy();

function sampleData(seed: number): HeapData {
    return new HeapData(Buffer.from([0, 0, 0, 0, 0, 0, 0, seed, seed + 1, seed + 2]));
}

function sampleOperationMessage(): Extract<ClusterMessage, { type: 'OPERATION' }> {
    const encoded = serializeOperation(new SetOperation('map', sampleData(1), sampleData(2), 33, 44));
    return {
        type: 'OPERATION',
        callId: 9,
        partitionId: 3,
        senderId: 'node-a',
        factoryId: encoded.factoryId,
        classId: encoded.classId,
        payload: encoded.payload,
    };
}

describe('BinarySerializationStrategy', () => {
    it('round-trips the full current transport surface', () => {
        const encoded = encodeData(sampleData(9));
        const operation = sampleOperationMessage();
        const backup: Extract<ClusterMessage, { type: 'BACKUP' }> = {
            type: 'BACKUP',
            callId: operation.callId,
            partitionId: operation.partitionId,
            replicaIndex: 1,
            senderId: 'node-b',
            callerId: 'node-a',
            sync: true,
            replicaVersions: ['0', '1'],
            factoryId: operation.factoryId,
            classId: operation.classId,
            payload: operation.payload,
        };

        const messages: ClusterMessage[] = [
            { type: 'HELLO', nodeId: 'node-a' },
            { type: 'MAP_PUT', mapName: 'm', key: { hello: 'world' }, value: ['v'] },
            { type: 'MAP_REMOVE', mapName: 'm', key: 42 },
            { type: 'MAP_CLEAR', mapName: 'm' },
            { type: 'INVALIDATE', mapName: 'm', key: 'k' },
            { type: 'JOIN_REQUEST', joinerAddress: { host: '127.0.0.1', port: 5701 }, joinerUuid: 'uuid-1', clusterName: 'helios', partitionCount: 271, joinerVersion: { major: 1, minor: 2, patch: 3 } },
            { type: 'FINALIZE_JOIN', memberListVersion: 2, members: [{ address: { host: '127.0.0.1', port: 5701 }, uuid: 'uuid-1', attributes: { role: 'data' }, liteMember: false, version: { major: 1, minor: 0, patch: 0 }, memberListJoinVersion: 1 }], masterAddress: { host: '127.0.0.1', port: 5701 }, clusterId: 'cluster-1' },
            { type: 'MEMBERS_UPDATE', memberListVersion: 3, members: [], masterAddress: { host: '127.0.0.1', port: 5701 }, clusterId: 'cluster-1' },
            { type: 'PARTITION_STATE', versions: [1, 2], partitions: [[null, { address: { host: '127.0.0.1', port: 5701 }, uuid: 'uuid-1' }]] },
            { type: 'HEARTBEAT', senderUuid: 'uuid-1', timestamp: 123 },
            { type: 'FETCH_MEMBERS_VIEW', requesterId: 'node-a', requestTimestamp: 456 },
            { type: 'MEMBERS_VIEW_RESPONSE', memberListVersion: 4, members: [] },
            operation,
            { type: 'OPERATION_RESPONSE', callId: 9, backupAcks: 1, backupMemberIds: ['node-b'], payload: { taskUuid: 't', status: 'success', originMemberUuid: 'node-a', resultData: sampleData(5), errorName: null, errorMessage: null } satisfies ExecutorOperationResult, error: null },
            backup,
            { type: 'BACKUP_ACK', callId: 9, senderId: 'node-b' },
            { type: 'RECOVERY_ANTI_ENTROPY', senderId: 'node-a', partitionId: 1, replicaIndex: 1, primaryVersions: ['1', '2'], namespaceVersions: { ns: ['3', '4'] } },
            { type: 'RECOVERY_SYNC_REQUEST', requestId: 'sync-1', requesterId: 'node-b', partitionId: 1, replicaIndex: 1, dirtyNamespaces: ['ns'] },
            { type: 'RECOVERY_SYNC_RESPONSE', requestId: 'sync-1', partitionId: 1, replicaIndex: 1, chunkIndex: 0, chunkCount: 1, versions: ['1', '2'], namespaceVersions: { ns: ['3'] }, namespaceStates: [{ namespace: 'ns', estimatedSizeBytes: 12, entries: [[encoded, encoded]] }] },
            { type: 'QUEUE_REQUEST', requestId: 'req', sourceNodeId: 'node-a', queueName: 'q', operation: 'offer', timeoutMs: 10, data: encoded, dataList: [encoded], maxElements: 5 },
            { type: 'QUEUE_RESPONSE', requestId: 'req', success: true, resultType: 'data-array', dataList: [encoded], error: undefined },
            { type: 'QUEUE_STATE_SYNC', requestId: 'req', sourceNodeId: 'node-a', queueName: 'q', version: 3, nextItemId: 7, items: [{ itemId: 1, enqueuedAt: 2, data: encoded }], ownerNodeId: 'node-a', counters: { offerOperationCount: 1, rejectedOfferOperationCount: 2, pollOperationCount: 3, emptyPollOperationCount: 4, otherOperationCount: 5, eventOperationCount: 6 } },
            { type: 'QUEUE_STATE_ACK', requestId: 'req', queueName: 'q', version: 3 },
            { type: 'QUEUE_EVENT', queueName: 'q', eventType: 'ADDED', sourceNodeId: 'node-a', data: encoded },
            { type: 'TOPIC_MESSAGE', topicName: 'topic', data: encoded, publishTime: 123, sourceNodeId: 'node-a', sequence: 1 },
            { type: 'TOPIC_PUBLISH_REQUEST', requestId: 'req', topicName: 'topic', data: encoded, publishTime: 123, sourceNodeId: 'node-a' },
            { type: 'TOPIC_ACK', requestId: 'req' },
            { type: 'RELIABLE_TOPIC_PUBLISH_REQUEST', requestId: 'req', topicName: 'rt', data: encoded, sourceNodeId: 'node-a' },
            { type: 'RELIABLE_TOPIC_PUBLISH_ACK', requestId: 'req' },
            { type: 'RELIABLE_TOPIC_MESSAGE', topicName: 'rt', sequence: 1, publishTime: 2, publisherAddress: 'member-1', data: encoded },
            { type: 'RELIABLE_TOPIC_BACKUP', requestId: 'req', topicName: 'rt', sequence: 1, publishTime: 2, publisherAddress: null, data: encoded, sourceNodeId: 'node-a' },
            { type: 'RELIABLE_TOPIC_BACKUP_ACK', requestId: 'req' },
            { type: 'RELIABLE_TOPIC_DESTROY', topicName: 'rt' },
            { type: 'BLITZ_NODE_REGISTER', registration: { memberId: 'm1', memberListVersion: 1, serverName: 'srv', clientPort: 4222, clusterPort: 6222, advertiseHost: '127.0.0.1', clusterName: 'helios', ready: true, startedAt: 12 } },
            { type: 'BLITZ_NODE_REMOVE', memberId: 'm1' },
            { type: 'BLITZ_TOPOLOGY_REQUEST', requestId: 'req' },
            { type: 'BLITZ_TOPOLOGY_RESPONSE', requestId: 'req', routes: ['nats://127.0.0.1:6222'], masterMemberId: 'm1', memberListVersion: 1, fenceToken: 'fence', registrationsComplete: true, clientConnectUrl: 'nats://127.0.0.1:4222' },
            { type: 'BLITZ_TOPOLOGY_ANNOUNCE', memberListVersion: 1, routes: ['nats://127.0.0.1:6222'], masterMemberId: 'm1', fenceToken: 'fence' },
        ];

        for (const message of messages) {
            expect(strategy.deserialize(strategy.serialize(message))).toEqual(message);
        }
    });

    it('round-trips all registered remote operations', () => {
        const descriptor = {
            taskUuid: 'task-1',
            executorName: 'exec',
            taskType: 'sum',
            registrationFingerprint: 'fp',
            inputData: Buffer.from([1, 2, 3]),
            submitterMemberUuid: 'member-1',
            timeoutMillis: 5_000,
        };

        const operations = [
            new PutOperation('map', sampleData(1), sampleData(2), 1, 2),
            new GetOperation('map', sampleData(1)),
            new RemoveOperation('map', sampleData(1)),
            new DeleteOperation('map', sampleData(1)),
            new SetOperation('map', sampleData(1), sampleData(2), 3, 4),
            new PutIfAbsentOperation('map', sampleData(1), sampleData(2), 5, 6),
            new ClearOperation('map'),
            new ExternalStoreClearOperation('map'),
            new PutBackupOperation('map', sampleData(1), sampleData(2), 7, 8),
            new RemoveBackupOperation('map', sampleData(1)),
            new ExecuteCallableOperation(descriptor),
            new MemberCallableOperation(descriptor, 'member-2'),
            new CancellationOperation('exec', 'task-1'),
            new ShutdownOperation('exec'),
        ];

        for (const operation of operations) {
            const encoded = serializeOperation(operation);
            const decoded = deserializeOperation(encoded.factoryId, encoded.classId, encoded.payload);
            const reencoded = serializeOperation(decoded);
            expect(reencoded).toEqual(encoded);
        }
    });

    it('round-trips supported operation response payload kinds', () => {
        const executorResult: ExecutorOperationResult = {
            taskUuid: 'task-1',
            status: 'success',
            originMemberUuid: 'member-1',
            resultData: sampleData(8),
            errorName: null,
            errorMessage: null,
        };
        const payloads = [null, sampleData(1), true, 42, 'hello', [sampleData(2), sampleData(3)], executorResult];

        for (const payload of payloads) {
            const encoded = encodeResponsePayload(payload);
            expect(decodeResponsePayload(encoded.kind, encoded.payload)).toEqual(payload);
        }
    });

    it('serializeInto matches serialize output bytes', () => {
        const message = sampleOperationMessage();
        const out = new ByteArrayObjectDataOutput(64, null, 'BE');

        strategy.serializeInto(out, message);

        expect(out.toByteArray()).toEqual(Buffer.from(strategy.serialize(message)));
    });
});
