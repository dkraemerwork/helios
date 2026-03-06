import { describe, it, expect } from 'bun:test';
import { ActionConstants } from '@zenystx/helios-core/security/permission/ActionConstants';
import { MapPermission } from '@zenystx/helios-core/security/permission/MapPermission';
import { CachePermission } from '@zenystx/helios-core/security/permission/CachePermission';
import { MultiMapPermission } from '@zenystx/helios-core/security/permission/MultiMapPermission';
import { ListPermission } from '@zenystx/helios-core/security/permission/ListPermission';
import { SetPermission } from '@zenystx/helios-core/security/permission/SetPermission';
import { AtomicLongPermission } from '@zenystx/helios-core/security/permission/AtomicLongPermission';
import { SemaphorePermission } from '@zenystx/helios-core/security/permission/SemaphorePermission';
import { TopicPermission } from '@zenystx/helios-core/security/permission/TopicPermission';
import { LockPermission } from '@zenystx/helios-core/security/permission/LockPermission';
import { ExecutorServicePermission } from '@zenystx/helios-core/security/permission/ExecutorServicePermission';
import { FlakeIdGeneratorPermission } from '@zenystx/helios-core/security/permission/FlakeIdGeneratorPermission';
import { ReplicatedMapPermission } from '@zenystx/helios-core/security/permission/ReplicatedMapPermission';
import { AtomicReferencePermission } from '@zenystx/helios-core/security/permission/AtomicReferencePermission';
import { CountDownLatchPermission } from '@zenystx/helios-core/security/permission/CountDownLatchPermission';
import { QueuePermission } from '@zenystx/helios-core/security/permission/QueuePermission';
import { CPMapPermission } from '@zenystx/helios-core/security/permission/CPMapPermission';
import { UserCodeNamespacePermission } from '@zenystx/helios-core/security/permission/UserCodeNamespacePermission';
import { VectorCollectionPermission } from '@zenystx/helios-core/security/permission/VectorCollectionPermission';

describe('ActionConstantsTest', () => {
    it('getPermission_whenNonExistingService', () => {
        expect(() => ActionConstants.getPermission('foo', "i don't exist")).toThrow();
    });

    it('getPermission_Map', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:mapService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(MapPermission);
    });

    it('getPermission_Cache', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:cacheService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(CachePermission);
    });

    it('getPermission_MultiMap', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:multiMapService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(MultiMapPermission);
    });

    it('getPermission_List', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:listService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(ListPermission);
    });

    it('getPermission_Set', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:setService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(SetPermission);
    });

    it('getPermission_AtomicLong', () => {
        const p = ActionConstants.getPermission('foo', 'hz:raft:atomicLongService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(AtomicLongPermission);
    });

    it('getPermission_Semaphore', () => {
        const p = ActionConstants.getPermission('foo', 'hz:raft:semaphoreService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(SemaphorePermission);
    });

    it('getPermission_Topic', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:topicService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(TopicPermission);
    });

    it('getPermission_Lock', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:lockService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(LockPermission);
    });

    it('getPermission_DistributedExecutor', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:executorService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(ExecutorServicePermission);
    });

    it('getPermission_FlakeIdGenerator', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:flakeIdGeneratorService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(FlakeIdGeneratorPermission);
    });

    it('getPermission_ReplicatedMap', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:replicatedMapService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(ReplicatedMapPermission);
    });

    it('getPermission_AtomicReference', () => {
        const p = ActionConstants.getPermission('foo', 'hz:raft:atomicRefService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(AtomicReferencePermission);
    });

    it('getPermission_CountdownLatch', () => {
        const p = ActionConstants.getPermission('foo', 'hz:raft:countDownLatchService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(CountDownLatchPermission);
    });

    it('getPermission_Queue', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:queueService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(QueuePermission);
    });

    it('getPermission_CPMap', () => {
        const p = ActionConstants.getPermission('foo', 'hz:raft:mapService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(CPMapPermission);
    });

    it('getPermission_NamespaceService', () => {
        const p = ActionConstants.getPermission('foo', 'hz:impl:namespaceService');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(UserCodeNamespacePermission);
    });

    it('getPermission_VectorCollection', () => {
        const p = ActionConstants.getPermission('foo', 'hz:service:vector');
        expect(p).not.toBeNull();
        expect(p).toBeInstanceOf(VectorCollectionPermission);
    });
});

