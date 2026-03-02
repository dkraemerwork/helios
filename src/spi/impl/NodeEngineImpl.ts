/**
 * Port of {@code com.hazelcast.spi.impl.NodeEngineImpl}, simplified for single-node
 * in-process operation.
 *
 * Wires all SPI services and provides dependency injection for ManagedService impls.
 * In Helios Phase 3 this is the only concrete NodeEngine. Phase 4 may introduce a
 * cluster-aware variant.
 */
import type { Data } from '@helios/internal/serialization/Data';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { NodeEngine } from '@helios/spi/NodeEngine';
import type { OperationService } from '@helios/spi/impl/operationservice/OperationService';
import type { ILogger } from '@helios/test-support/ILogger';
import type { HeliosProperties } from '@helios/spi/properties/HeliosProperties';
import type { PartitionService } from '@helios/spi/PartitionService';
import { ConsoleLogger } from '@helios/test-support/ILogger';
import { OperationServiceImpl } from '@helios/spi/impl/operationservice/impl/OperationServiceImpl';
import { HeliosException } from '@helios/core/exception/HeliosException';
import { MapHeliosProperties } from '@helios/spi/properties/HeliosProperties';

/** Minimal single-node partition service: 271 partitions, all local. */
class SingleNodePartitionService implements PartitionService {
    getPartitionCount(): number { return 271; }
}

export class NodeEngineImpl implements NodeEngine {
    private readonly _services = new Map<string, unknown>();
    private readonly _serializationService: SerializationService;
    private readonly _operationService: OperationService;
    private readonly _properties: HeliosProperties;
    private readonly _partitionService: PartitionService;
    private readonly _loggers = new Map<string, ILogger>();
    private _running = true;

    constructor(serializationService: SerializationService) {
        this._serializationService = serializationService;
        this._properties = new MapHeliosProperties();
        this._partitionService = new SingleNodePartitionService();
        // OperationServiceImpl is wired here; it back-references this NodeEngine.
        this._operationService = new OperationServiceImpl(this);
    }

    /**
     * Register a service by name so it can be retrieved via getService/getServiceOrNull.
     * Typically called during node startup.
     */
    registerService(serviceName: string, service: unknown): void {
        this._services.set(serviceName, service);
    }

    // ── NodeEngine interface ───────────────────────────────────────────────

    getOperationService(): OperationService {
        return this._operationService;
    }

    getProperties(): HeliosProperties { return this._properties; }

    getPartitionService(): PartitionService { return this._partitionService; }

    getSerializationService(): SerializationService {
        return this._serializationService;
    }

    getLogger(nameOrClass: string | (new (...args: unknown[]) => unknown)): ILogger {
        if (nameOrClass === null || nameOrClass === undefined) {
            throw new Error('nameOrClass must not be null');
        }
        const name = typeof nameOrClass === 'string' ? nameOrClass : nameOrClass.name;
        let logger = this._loggers.get(name);
        if (!logger) {
            logger = new ConsoleLogger(name);
            this._loggers.set(name, logger);
        }
        return logger;
    }

    isRunning(): boolean { return this._running; }
    isStartCompleted(): boolean { return this._running; }

    getService<T>(serviceName: string): T {
        if (serviceName === null || serviceName === undefined) {
            throw new Error('serviceName must not be null');
        }
        const service = this._services.get(serviceName);
        if (service === undefined) {
            throw new HeliosException(`Service not found: '${serviceName}'`);
        }
        return service as T;
    }

    getServiceOrNull<T>(serviceName: string): T | null {
        if (serviceName === null || serviceName === undefined) {
            return null;
        }
        const service = this._services.get(serviceName);
        return service !== undefined ? (service as T) : null;
    }

    toData(obj: unknown): Data | null {
        return this._serializationService.toData(obj);
    }

    toObject<T>(data: Data | null): T | null {
        return this._serializationService.toObject<T>(data);
    }

    // ── lifecycle ─────────────────────────────────────────────────────────

    shutdown(): void {
        this._running = false;
    }
}
