/**
 * Registry and factory for split-brain merge policies.
 * Port of {@code com.hazelcast.spi.merge.SplitBrainMergePolicyProvider}.
 */
import type { SplitBrainMergePolicy } from './SplitBrainMergePolicy';
import { DiscardMergePolicy } from './DiscardMergePolicy';
import { ExpirationTimeMergePolicy } from './ExpirationTimeMergePolicy';
import { HigherHitsMergePolicy } from './HigherHitsMergePolicy';
import { HyperLogLogMergePolicy } from './HyperLogLogMergePolicy';
import { LatestAccessMergePolicy } from './LatestAccessMergePolicy';
import { LatestUpdateMergePolicy } from './LatestUpdateMergePolicy';
import { PassThroughMergePolicy } from './PassThroughMergePolicy';
import { PutIfAbsentMergePolicy } from './PutIfAbsentMergePolicy';

const BUILTIN_POLICIES: ReadonlyMap<string, () => SplitBrainMergePolicy> = new Map([
    ['PassThroughMergePolicy', () => new PassThroughMergePolicy()],
    ['PutIfAbsentMergePolicy', () => new PutIfAbsentMergePolicy()],
    ['HigherHitsMergePolicy', () => new HigherHitsMergePolicy()],
    ['LatestUpdateMergePolicy', () => new LatestUpdateMergePolicy()],
    ['LatestAccessMergePolicy', () => new LatestAccessMergePolicy()],
    ['ExpirationTimeMergePolicy', () => new ExpirationTimeMergePolicy()],
    ['DiscardMergePolicy', () => new DiscardMergePolicy()],
    ['HyperLogLogMergePolicy', () => new HyperLogLogMergePolicy()],
]);

export class MergePolicyProvider {
    getMergePolicy(policyName: string): SplitBrainMergePolicy {
        const factory = BUILTIN_POLICIES.get(policyName);
        if (!factory) {
            throw new Error(
                `Unknown merge policy: ${policyName}. ` +
                `Available: ${[...BUILTIN_POLICIES.keys()].join(', ')}`,
            );
        }
        return factory();
    }

    getAvailablePolicies(): string[] {
        return [...BUILTIN_POLICIES.keys()];
    }
}
