/**
 * Client-side proxy for the distributed scheduled executor service.
 *
 * Implements {@link IScheduledExecutorService} by routing all operations
 * through the {@link ScheduledExecutorContainerService}, creating
 * {@link ClientScheduledFutureProxy} instances for result handling,
 * and supporting handler-based future reacquisition across client reconnect.
 *
 * Hazelcast parity: com.hazelcast.client.impl.proxy.ClientScheduledExecutorProxy
 */

import type { Member } from '@zenystx/helios-core/cluster/Member.js';
import type { ScheduledExecutorConfig } from '@zenystx/helios-core/config/ScheduledExecutorConfig.js';
import { ExecutorRejectedExecutionException } from '@zenystx/helios-core/executor/ExecutorExceptions.js';
import type { TaskCallable } from '@zenystx/helios-core/executor/TaskCallable.js';
import type { IScheduledExecutorService } from '@zenystx/helios-core/scheduledexecutor/IScheduledExecutorService.js';
import type { IScheduledFuture } from '@zenystx/helios-core/scheduledexecutor/IScheduledFuture.js';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler.js';
import type { ScheduledExecutorContainerService } from '@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService.js';
import { ClientScheduledFutureProxy } from './ClientScheduledFutureProxy.js';
import type { TaskDefinition } from '@zenystx/helios-core/scheduledexecutor/impl/TaskDefinition.js';

export class ClientScheduledExecutorProxy implements IScheduledExecutorService {
    private readonly _name: string;
    private readonly _containerService: ScheduledExecutorContainerService;
    private readonly _config: ScheduledExecutorConfig;
    private readonly _partitionCount: number;
    private _shutdown = false;
    private _nextPartition = 0;
    private _clusterMembers: Member[] = [];

    constructor(
        name: string,
        containerService: ScheduledExecutorContainerService,
        config: ScheduledExecutorConfig,
        partitionCount: number,
    ) {
        this._name = name;
        this._containerService = containerService;
        this._config = config;
        this._partitionCount = partitionCount;
    }

    getName(): string {
        return this._name;
    }

    isShutdown(): boolean {
        return this._shutdown;
    }

    setClusterMembers(members: Member[]): void {
        this._clusterMembers = members;
    }

    // ── One-shot scheduling ─────────────────────────────────────────────

    async schedule<V>(task: TaskCallable<V>, delayMs: number): Promise<IScheduledFuture<V>> {
        this._checkNotShutdown();
        const partitionId = this._nextPartitionId();
        const definition = this._buildDefinition(task, delayMs, 0, 'SINGLE_RUN');
        const descriptor = this._containerService.scheduleOnPartition(this._name, definition, partitionId);

        const handler = ScheduledTaskHandler.ofPartition(this._name, descriptor.taskName, partitionId);
        return new ClientScheduledFutureProxy<V>(handler, this._containerService);
    }

    async scheduleOnMember<V>(task: TaskCallable<V>, member: Member, delayMs: number): Promise<IScheduledFuture<V>> {
        this._checkNotShutdown();
        const memberUuid = member.getUuid();
        const definition = this._buildDefinition(task, delayMs, 0, 'SINGLE_RUN');
        const descriptor = this._containerService.scheduleOnMember(this._name, definition, memberUuid);

        const handler = ScheduledTaskHandler.ofMember(this._name, descriptor.taskName, memberUuid);
        return new ClientScheduledFutureProxy<V>(handler, this._containerService);
    }

    async scheduleOnKeyOwner<V>(task: TaskCallable<V>, _key: unknown, delayMs: number): Promise<IScheduledFuture<V>> {
        this._checkNotShutdown();
        const partitionId = this._nextPartitionId();
        const definition = this._buildDefinition(task, delayMs, 0, 'SINGLE_RUN');
        const descriptor = this._containerService.scheduleOnPartition(this._name, definition, partitionId);

        const handler = ScheduledTaskHandler.ofPartition(this._name, descriptor.taskName, partitionId);
        return new ClientScheduledFutureProxy<V>(handler, this._containerService);
    }

    async scheduleOnAllMembers<V>(task: TaskCallable<V>, delayMs: number): Promise<Map<Member, IScheduledFuture<V>>> {
        this._checkNotShutdown();
        const result = new Map<Member, IScheduledFuture<V>>();
        for (const member of this._clusterMembers) {
            const future = await this.scheduleOnMember(task, member, delayMs);
            result.set(member, future);
        }
        return result;
    }

    async scheduleOnMembers<V>(task: TaskCallable<V>, members: Iterable<Member>, delayMs: number): Promise<Map<Member, IScheduledFuture<V>>> {
        this._checkNotShutdown();
        const result = new Map<Member, IScheduledFuture<V>>();
        for (const member of members) {
            const future = await this.scheduleOnMember(task, member, delayMs);
            result.set(member, future);
        }
        return result;
    }

    // ── Fixed-rate scheduling ───────────────────────────────────────────

    async scheduleAtFixedRate(task: TaskCallable<void>, initialDelayMs: number, periodMs: number): Promise<IScheduledFuture<void>> {
        this._checkNotShutdown();
        const partitionId = this._nextPartitionId();
        const definition = this._buildDefinition(task, initialDelayMs, periodMs, 'AT_FIXED_RATE');
        const descriptor = this._containerService.scheduleOnPartition(this._name, definition, partitionId);

        const handler = ScheduledTaskHandler.ofPartition(this._name, descriptor.taskName, partitionId);
        return new ClientScheduledFutureProxy<void>(handler, this._containerService);
    }

    async scheduleOnMemberAtFixedRate(task: TaskCallable<void>, member: Member, initialDelayMs: number, periodMs: number): Promise<IScheduledFuture<void>> {
        this._checkNotShutdown();
        const memberUuid = member.getUuid();
        const definition = this._buildDefinition(task, initialDelayMs, periodMs, 'AT_FIXED_RATE');
        const descriptor = this._containerService.scheduleOnMember(this._name, definition, memberUuid);

        const handler = ScheduledTaskHandler.ofMember(this._name, descriptor.taskName, memberUuid);
        return new ClientScheduledFutureProxy<void>(handler, this._containerService);
    }

    async scheduleOnKeyOwnerAtFixedRate(task: TaskCallable<void>, _key: unknown, initialDelayMs: number, periodMs: number): Promise<IScheduledFuture<void>> {
        this._checkNotShutdown();
        const partitionId = this._nextPartitionId();
        const definition = this._buildDefinition(task, initialDelayMs, periodMs, 'AT_FIXED_RATE');
        const descriptor = this._containerService.scheduleOnPartition(this._name, definition, partitionId);

        const handler = ScheduledTaskHandler.ofPartition(this._name, descriptor.taskName, partitionId);
        return new ClientScheduledFutureProxy<void>(handler, this._containerService);
    }

    async scheduleOnAllMembersAtFixedRate(task: TaskCallable<void>, initialDelayMs: number, periodMs: number): Promise<Map<Member, IScheduledFuture<void>>> {
        this._checkNotShutdown();
        const result = new Map<Member, IScheduledFuture<void>>();
        for (const member of this._clusterMembers) {
            const future = await this.scheduleOnMemberAtFixedRate(task, member, initialDelayMs, periodMs);
            result.set(member, future);
        }
        return result;
    }

    async scheduleOnMembersAtFixedRate(task: TaskCallable<void>, members: Iterable<Member>, initialDelayMs: number, periodMs: number): Promise<Map<Member, IScheduledFuture<void>>> {
        this._checkNotShutdown();
        const result = new Map<Member, IScheduledFuture<void>>();
        for (const member of members) {
            const future = await this.scheduleOnMemberAtFixedRate(task, member, initialDelayMs, periodMs);
            result.set(member, future);
        }
        return result;
    }

    // ── Future recovery and introspection ───────────────────────────────

    getScheduledFuture<V>(handler: ScheduledTaskHandler): IScheduledFuture<V> {
        if (!handler) {
            throw new Error('Handler is null');
        }
        return new ClientScheduledFutureProxy<V>(handler, this._containerService);
    }

    async getAllScheduledFutures(): Promise<Map<Member, IScheduledFuture<unknown>[]>> {
        const futures: IScheduledFuture<unknown>[] = [];

        for (let partitionId = 0; partitionId < this._partitionCount; partitionId++) {
            const partition = this._containerService.getPartition(partitionId);
            const store = partition.getOrCreateContainer(this._name);
            for (const descriptor of store.getAll()) {
                const handler = ScheduledTaskHandler.ofPartition(
                    this._name,
                    descriptor.taskName,
                    partitionId,
                );
                futures.push(new ClientScheduledFutureProxy(handler, this._containerService));
            }
        }

        const memberBin = this._containerService.getMemberBin();
        const memberStore = memberBin.getOrCreateContainer(this._name);
        for (const descriptor of memberStore.getAll()) {
            const handler = ScheduledTaskHandler.ofMember(
                this._name,
                descriptor.taskName,
                descriptor.memberUuid ?? '',
            );
            futures.push(new ClientScheduledFutureProxy(handler, this._containerService));
        }

        const result = new Map<Member, IScheduledFuture<unknown>[]>();
        if (futures.length > 0) {
            result.set({} as Member, futures);
        }
        return result;
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    async shutdown(): Promise<void> {
        this._shutdown = true;
    }

    // ── Private helpers ─────────────────────────────────────────────────

    private _checkNotShutdown(): void {
        if (this._shutdown) {
            throw new ExecutorRejectedExecutionException(`ScheduledExecutor "${this._name}" is shut down`);
        }
    }

    private _nextPartitionId(): number {
        const id = this._nextPartition % this._partitionCount;
        this._nextPartition++;
        return id;
    }

    private _buildDefinition(
        task: TaskCallable<unknown>,
        delayMs: number,
        periodMs: number,
        type: 'SINGLE_RUN' | 'AT_FIXED_RATE',
    ): TaskDefinition {
        return {
            name: '',
            command: task.taskType,
            delay: delayMs,
            period: periodMs,
            type,
            autoDisposable: false,
        };
    }
}
