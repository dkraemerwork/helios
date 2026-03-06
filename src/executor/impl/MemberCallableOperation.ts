/**
 * Member-targeted executor operation with no-retry semantics.
 *
 * Unlike partition-targeted {@link ExecuteCallableOperation}, this operation
 * does NOT retry on {@link MemberLeftException} or {@link TargetNotMemberException}.
 * If the target member departs, the invocation fails immediately.
 */
import { ExecuteCallableOperation, type TaskDescriptor } from '@zenystx/core/executor/impl/ExecuteCallableOperation.js';

export class MemberCallableOperation extends ExecuteCallableOperation {
    readonly targetMemberUuid: string;

    constructor(descriptor: TaskDescriptor, targetMemberUuid?: string) {
        super(descriptor);
        this.targetMemberUuid = targetMemberUuid ?? '';
    }

    /** Member-targeted operations never retry on member departure. */
    override shouldRetryOnMemberLeft(): boolean {
        return false;
    }
}
