/**
 * Executor-specific response envelope returned by executor operations.
 * The proxy unwraps this and deserializes resultData before completing the caller's future.
 */

import type { Data } from '@helios/internal/serialization/Data.js';

export interface ExecutorOperationResult {
    readonly taskUuid: string;
    readonly status: 'success' | 'cancelled' | 'rejected' | 'task-lost' | 'timeout';
    readonly originMemberUuid: string;
    readonly resultData: Data | null;
    readonly errorName: string | null;
    readonly errorMessage: string | null;
}
