import type { InstancePermission } from './InstancePermission';

/** Port of com.hazelcast.security.permission.ActionConstants */

type PermissionFactory = (name: string, ...actions: string[]) => InstancePermission;

export class ActionConstants {
    static readonly ACTION_ALL = 'all';
    static readonly ACTION_CREATE = 'create';
    static readonly ACTION_DESTROY = 'destroy';
    static readonly ACTION_MODIFY = 'modify';
    static readonly ACTION_READ = 'read';
    static readonly ACTION_REMOVE = 'remove';
    static readonly ACTION_LOCK = 'lock';
    static readonly ACTION_LISTEN = 'listen';
    static readonly ACTION_RELEASE = 'release';
    static readonly ACTION_ACQUIRE = 'acquire';
    static readonly ACTION_PUT = 'put';
    static readonly ACTION_ADD = 'add';
    static readonly ACTION_INDEX = 'index';
    static readonly ACTION_INTERCEPT = 'intercept';
    static readonly ACTION_PUBLISH = 'publish';
    static readonly ACTION_AGGREGATE = 'aggregate';
    static readonly ACTION_PROJECTION = 'projection';
    static readonly ACTION_USER_CODE_DEPLOY = 'deploy';
    static readonly ACTION_USE = 'use';
    static readonly ACTION_OPTIMIZE = 'optimize';
    static readonly ACTION_SUBMIT = 'submit';
    static readonly ACTION_CANCEL = 'cancel';
    static readonly ACTION_RESTART = 'restart';
    static readonly ACTION_EXPORT_SNAPSHOT = 'export-snapshot';
    static readonly ACTION_ADD_RESOURCES = 'add-resources';
    static readonly ACTION_WRITE = 'write';

    static readonly LISTENER_INSTANCE = 'instance';
    static readonly LISTENER_MEMBER = 'member';
    static readonly LISTENER_MIGRATION = 'migration';

    static readonly ACTION_VIEW_MAPPING = 'view-mapping';
    static readonly ACTION_CREATE_VIEW = 'create-view';
    static readonly ACTION_DROP_VIEW = 'drop-view';
    static readonly ACTION_CREATE_TYPE = 'create-type';
    static readonly ACTION_DROP_TYPE = 'drop-type';
    static readonly ACTION_VIEW_DATACONNECTION = 'view-dataconnection';
    static readonly ACTION_CREATE_DATACONNECTION = 'create-dataconnection';
    static readonly ACTION_DROP_DATACONNECTION = 'drop-dataconnection';

    private static _factories: Map<string, PermissionFactory> | null = null;

    private static buildFactories(): Map<string, PermissionFactory> {
        // Import lazily to avoid circular dependency during module initialization.
        // All concrete permission classes import ACTION_* constants from this file,
        // so we must not import them at the top level.
        const { MapPermission } = require('./MapPermission') as typeof import('./MapPermission');
        const { CachePermission } = require('./CachePermission') as typeof import('./CachePermission');
        const { MultiMapPermission } = require('./MultiMapPermission') as typeof import('./MultiMapPermission');
        const { ListPermission } = require('./ListPermission') as typeof import('./ListPermission');
        const { SetPermission } = require('./SetPermission') as typeof import('./SetPermission');
        const { AtomicLongPermission } = require('./AtomicLongPermission') as typeof import('./AtomicLongPermission');
        const { CountDownLatchPermission } = require('./CountDownLatchPermission') as typeof import('./CountDownLatchPermission');
        const { SemaphorePermission } = require('./SemaphorePermission') as typeof import('./SemaphorePermission');
        const { TopicPermission } = require('./TopicPermission') as typeof import('./TopicPermission');
        const { LockPermission } = require('./LockPermission') as typeof import('./LockPermission');
        const { ExecutorServicePermission } = require('./ExecutorServicePermission') as typeof import('./ExecutorServicePermission');
        const { FlakeIdGeneratorPermission } = require('./FlakeIdGeneratorPermission') as typeof import('./FlakeIdGeneratorPermission');
        const { ReplicatedMapPermission } = require('./ReplicatedMapPermission') as typeof import('./ReplicatedMapPermission');
        const { AtomicReferencePermission } = require('./AtomicReferencePermission') as typeof import('./AtomicReferencePermission');
        const { QueuePermission } = require('./QueuePermission') as typeof import('./QueuePermission');
        const { CPMapPermission } = require('./CPMapPermission') as typeof import('./CPMapPermission');
        const { UserCodeNamespacePermission } = require('./UserCodeNamespacePermission') as typeof import('./UserCodeNamespacePermission');
        const { VectorCollectionPermission } = require('./VectorCollectionPermission') as typeof import('./VectorCollectionPermission');
        const { CardinalityEstimatorPermission } = require('./CardinalityEstimatorPermission') as typeof import('./CardinalityEstimatorPermission');
        const { ScheduledExecutorPermission } = require('./ScheduledExecutorPermission') as typeof import('./ScheduledExecutorPermission');

        const m = new Map<string, PermissionFactory>();
        m.set('hz:impl:queueService',               (n, ...a) => new QueuePermission(n, ...a));
        m.set('hz:impl:mapService',                 (n, ...a) => new MapPermission(n, ...a));
        m.set('hz:impl:multiMapService',            (n, ...a) => new MultiMapPermission(n, ...a));
        m.set('hz:impl:listService',                (n, ...a) => new ListPermission(n, ...a));
        m.set('hz:impl:setService',                 (n, ...a) => new SetPermission(n, ...a));
        m.set('hz:raft:atomicLongService',          (n, ...a) => new AtomicLongPermission(n, ...a));
        m.set('hz:raft:countDownLatchService',      (n, ...a) => new CountDownLatchPermission(n, ...a));
        m.set('hz:raft:semaphoreService',           (n, ...a) => new SemaphorePermission(n, ...a));
        m.set('hz:impl:topicService',               (n, ...a) => new TopicPermission(n, ...a));
        m.set('hz:impl:lockService',                (n, ...a) => new LockPermission(n, ...a));
        m.set('hz:raft:lockService',                (n, ...a) => new LockPermission(n, ...a));
        m.set('hz:impl:executorService',            (n, ...a) => new ExecutorServicePermission(n, ...a));
        m.set('hz:impl:flakeIdGeneratorService',    (n, ...a) => new FlakeIdGeneratorPermission(n, ...a));
        m.set('hz:impl:replicatedMapService',       (n, ...a) => new ReplicatedMapPermission(n, ...a));
        m.set('hz:raft:atomicRefService',           (n, ...a) => new AtomicReferencePermission(n, ...a));
        m.set('hz:impl:cacheService',               (n, ...a) => new CachePermission(n, ...a));
        m.set('hz:impl:ringbufferService',          (n, ...a) => new QueuePermission(n, ...a));
        m.set('hz:impl:cardinalityEstimatorService',(n, ...a) => new CardinalityEstimatorPermission(n, ...a));
        m.set('hz:impl:scheduledExecutorService',   (n, ...a) => new ScheduledExecutorPermission(n, ...a));
        m.set('hz:raft:mapService',                 (n, ...a) => new CPMapPermission(n, ...a));
        m.set('hz:impl:namespaceService',           (n, ...a) => new UserCodeNamespacePermission(n, ...a));
        m.set('hz:service:vector',                  (n, ...a) => new VectorCollectionPermission(n, ...a));
        m.set('hz:impl:reliableTopicService',       (n, ...a) => new TopicPermission(n, ...a));
        return m;
    }

    private constructor() {}

    /**
     * Creates a permission for the given service name.
     * @throws Error if the service name is not recognized.
     */
    static getPermission(name: string, serviceName: string, ...actions: string[]): InstancePermission {
        if (ActionConstants._factories == null) {
            ActionConstants._factories = ActionConstants.buildFactories();
        }
        const factory = ActionConstants._factories.get(serviceName);
        if (factory == null) {
            throw new Error(`No permissions found for service: ${serviceName}`);
        }
        return factory(name, ...actions);
    }
}
