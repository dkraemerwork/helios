import type { ObjectNamespace } from '@helios/internal/services/ObjectNamespace';

/** Default ObjectNamespace implementation for distributed objects. */
export class DistributedObjectNamespace implements ObjectNamespace {
    private readonly service: string;
    private readonly objectName: string;

    constructor(serviceName: string, objectName: string) {
        this.service = serviceName;
        this.objectName = objectName;
    }

    getServiceName(): string {
        return this.service;
    }

    getObjectName(): string {
        return this.objectName;
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof DistributedObjectNamespace)) return false;
        return this.service === other.service && this.objectName === other.objectName;
    }

    hashCode(): number {
        let result = hashString(this.service);
        result = (31 * result + hashString(this.objectName)) | 0;
        return result;
    }

    toString(): string {
        return `DistributedObjectNamespace{service='${this.service}', objectName='${this.objectName}'}`;
    }
}

function hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return h;
}
