/**
 * LoadBalancer interface and implementations for client connection routing.
 *
 * When a client connects and load balancing is enabled, the load balancer
 * selects the target member to route the client to.
 *
 * Port of {@code com.hazelcast.client.LoadBalancer}.
 */
import type { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo';

/** Strategy used when selecting the next member. */
export enum LoadBalancerType {
    ROUND_ROBIN = 'ROUND_ROBIN',
    RANDOM = 'RANDOM',
}

/**
 * Selects a member for each client connection.
 *
 * Call {@link init} once with the current member list, then call {@link next}
 * for every client that connects.  Implementations must be thread-safe with
 * respect to concurrent {@link next} calls.
 */
export interface LoadBalancer {
    /** The strategy implemented by this load balancer. */
    readonly type: LoadBalancerType;

    /**
     * Initialize (or re-initialize) the balancer with the current member list.
     * @param members Current cluster members available for routing.
     */
    init(members: MemberInfo[]): void;

    /**
     * Select the next member for a connecting client.
     * @returns The selected MemberInfo, or {@code null} when no members are available.
     */
    next(): MemberInfo | null;
}

/**
 * Round-robin load balancer.
 *
 * Iterates through members in insertion order, wrapping around when the end
 * of the list is reached.  The index counter uses a simple modulo so that it
 * stays valid even if {@link init} is called with a shorter member list.
 */
export class RoundRobinLoadBalancer implements LoadBalancer {
    readonly type = LoadBalancerType.ROUND_ROBIN;

    private _members: MemberInfo[] = [];
    private _index: number = 0;

    init(members: MemberInfo[]): void {
        this._members = members.slice();
        // Keep the index in range after a membership change
        if (this._members.length > 0) {
            this._index = this._index % this._members.length;
        } else {
            this._index = 0;
        }
    }

    next(): MemberInfo | null {
        if (this._members.length === 0) {
            return null;
        }
        const member = this._members[this._index];
        this._index = (this._index + 1) % this._members.length;
        return member;
    }
}

/**
 * Random load balancer.
 *
 * Picks a uniformly random member on each call to {@link next}.
 */
export class RandomLoadBalancer implements LoadBalancer {
    readonly type = LoadBalancerType.RANDOM;

    private _members: MemberInfo[] = [];

    init(members: MemberInfo[]): void {
        this._members = members.slice();
    }

    next(): MemberInfo | null {
        if (this._members.length === 0) {
            return null;
        }
        const idx = Math.floor(Math.random() * this._members.length);
        return this._members[idx];
    }
}

/**
 * Factory helper — create a {@link LoadBalancer} from a {@link LoadBalancerType}.
 */
export function createLoadBalancer(type: LoadBalancerType): LoadBalancer {
    switch (type) {
        case LoadBalancerType.ROUND_ROBIN:
            return new RoundRobinLoadBalancer();
        case LoadBalancerType.RANDOM:
            return new RandomLoadBalancer();
    }
}
