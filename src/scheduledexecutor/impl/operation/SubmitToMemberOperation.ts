/**
 * Creates a scheduled task descriptor in the member bin store.
 *
 * Hazelcast parity: com.hazelcast.scheduledexecutor.impl.operations.ScheduleTaskOperation
 * (member-targeted variant)
 */

import { randomUUID } from 'crypto';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { ScheduledTaskHandler } from '@zenystx/helios-core/scheduledexecutor/ScheduledTaskHandler';
import { ScheduledTaskDescriptor } from '../ScheduledTaskDescriptor.js';
import type { ScheduledExecutorContainerService } from '../ScheduledExecutorContainerService.js';
import type { TaskDefinition } from '../TaskDefinition.js';

export class SubmitToMemberOperation extends Operation {
    private readonly _executorName: string;
    private readonly _definition: TaskDefinition;
    private readonly _memberUuid: string;
    private readonly _containerService: ScheduledExecutorContainerService;

    constructor(
        executorName: string,
        definition: TaskDefinition,
        memberUuid: string,
        containerService: ScheduledExecutorContainerService,
    ) {
        super();
        this._executorName = executorName;
        this._definition = definition;
        this._memberUuid = memberUuid;
        this._containerService = containerService;
    }

    async run(): Promise<void> {
        const now = Date.now();
        const nextRunAt = now + this._definition.delay;

        const descriptor = new ScheduledTaskDescriptor({
            taskName: this._definition.name,
            handlerId: randomUUID(),
            executorName: this._executorName,
            taskType: this._definition.command,
            scheduleKind: this._definition.type === 'SINGLE_RUN' ? 'ONE_SHOT' : 'FIXED_RATE',
            ownerKind: 'MEMBER',
            memberUuid: this._memberUuid,
            initialDelayMillis: this._definition.delay,
            periodMillis: this._definition.period,
            nextRunAt,
        });

        const store = this._containerService.getMemberBin().getOrCreateContainer(this._executorName);
        store.schedule(descriptor);

        const handler = ScheduledTaskHandler.ofMember(
            this._executorName,
            descriptor.taskName,
            this._memberUuid,
        );

        this.sendResponse(handler);
    }
}
