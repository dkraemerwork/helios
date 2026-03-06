import type { ObjectNamespace } from '@zenystx/helios-core/internal/services/ObjectNamespace';
import { DistributedObjectNamespace } from '@zenystx/helios-core/internal/services/DistributedObjectNamespace';

/**
 * A key to enable waiting for an item to be published in the ringbuffer.
 * The exact ringbuffer is identified by partition ID and namespace.
 */
export class RingbufferWaitNotifyKey {
    private readonly namespace: ObjectNamespace;
    private readonly partitionId: number;

    constructor(namespace: ObjectNamespace, partitionId: number) {
        if (namespace == null) throw new Error('namespace must not be null');
        this.namespace = namespace;
        this.partitionId = partitionId;
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (other == null || !(other instanceof RingbufferWaitNotifyKey)) return false;
        return this.partitionId === other.partitionId && namespaceEquals(this.namespace, other.namespace);
    }

    hashCode(): number {
        let result = namespaceHashCode(this.namespace);
        result = (31 * result + this.partitionId) | 0;
        return result;
    }

    getServiceName(): string {
        return this.namespace.getServiceName();
    }

    getObjectName(): string {
        return this.namespace.getObjectName();
    }

    toString(): string {
        return `RingbufferWaitNotifyKey{namespace=${this.namespace.toString()}, partitionId=${this.partitionId}}`;
    }
}

function namespaceEquals(a: ObjectNamespace, b: ObjectNamespace): boolean {
    if (a instanceof DistributedObjectNamespace && b instanceof DistributedObjectNamespace) {
        return a.equals(b);
    }
    return a.getServiceName() === b.getServiceName() && a.getObjectName() === b.getObjectName();
}

function namespaceHashCode(ns: ObjectNamespace): number {
    if (ns instanceof DistributedObjectNamespace) {
        return ns.hashCode();
    }
    return hashString(ns.getServiceName()) ^ hashString(ns.getObjectName());
}

function hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return h;
}
