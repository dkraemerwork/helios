import type { ServiceNamespace } from '@helios/internal/services/ServiceNamespace';

/** Identifies an object within a service. */
export interface ObjectNamespace extends ServiceNamespace {
    getServiceName(): string;
    getObjectName(): string;
}
