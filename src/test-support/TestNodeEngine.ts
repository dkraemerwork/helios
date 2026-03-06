/**
 * Minimal NodeEngine stub for unit tests.
 *
 * Provides real serialization (JSON-based TestSerializationService) and a
 * console logger. Implements the NodeEngine interface defined in Block 3.1.
 *
 * Block 3.0 introduced this class; Block 3.1 upgraded it to formally implement
 * the NodeEngine interface with OperationService support.
 */
import type { Data } from '@zenystx/core/internal/serialization/Data';
import type { SerializationService } from '@zenystx/core/internal/serialization/SerializationService';
import type { NodeEngine, ClusterServiceView } from '@zenystx/core/spi/NodeEngine';
import type { OperationService } from '@zenystx/core/spi/impl/operationservice/OperationService';
import type { ILogger } from '@zenystx/core/test-support/ILogger';
import type { HeliosProperties } from '@zenystx/core/spi/properties/HeliosProperties';
import { ConsoleLogger } from '@zenystx/core/test-support/ILogger';
import { TestSerializationService } from '@zenystx/core/test-support/TestSerializationService';
import { TestPartitionService } from '@zenystx/core/test-support/TestPartitionService';
import { OperationServiceImpl } from '@zenystx/core/spi/impl/operationservice/impl/OperationServiceImpl';
import { HeliosException } from '@zenystx/core/core/exception/HeliosException';
import { MapHeliosProperties } from '@zenystx/core/spi/properties/HeliosProperties';
import { Address } from '@zenystx/core/cluster/Address';

export class TestNodeEngine implements NodeEngine {
    private readonly _localAddress = new Address('127.0.0.1', 5701);
    private readonly _serializationService: SerializationService = new TestSerializationService();
    private readonly _partitionService: TestPartitionService = new TestPartitionService();
    private readonly _properties: HeliosProperties = new MapHeliosProperties();
    private readonly _loggers = new Map<string, ILogger>();
    private readonly _services = new Map<string, unknown>();
    private _operationService: OperationService | null = null;

    // ── service registry (for tests that need getService) ─────────────────

    /** Register a service so getService/getServiceOrNull can find it. */
    registerService(serviceName: string, service: unknown): void {
        this._services.set(serviceName, service);
    }

    // ── NodeEngine interface ───────────────────────────────────────────────

    getOperationService(): OperationService {
        if (this._operationService === null) {
            this._operationService = new OperationServiceImpl(this);
        }
        return this._operationService;
    }

    getSerializationService(): SerializationService {
        return this._serializationService;
    }

    getProperties(): HeliosProperties { return this._properties; }

    getPartitionService(): TestPartitionService {
        return this._partitionService;
    }

    getLogger(nameOrClass: string | (new (...args: unknown[]) => unknown)): ILogger {
        const name = typeof nameOrClass === 'string' ? nameOrClass : nameOrClass.name;
        let logger = this._loggers.get(name);
        if (logger === undefined) {
            logger = new ConsoleLogger(name);
            this._loggers.set(name, logger);
        }
        return logger;
    }

    isRunning(): boolean { return true; }
    isStartCompleted(): boolean { return true; }

    getService<T>(serviceName: string): T {
        if (serviceName === null || serviceName === undefined) {
            throw new Error('serviceName must not be null');
        }
        const service = this._services.get(serviceName);
        if (service === undefined) {
            throw new HeliosException(`TestNodeEngine.getService: service not found: '${serviceName}'`);
        }
        return service as T;
    }

    getServiceOrNull<T>(serviceName: string): T | null {
        if (serviceName === null || serviceName === undefined) return null;
        const service = this._services.get(serviceName);
        return service !== undefined ? (service as T) : null;
    }

    toData(obj: unknown): Data | null {
        return this._serializationService.toData(obj);
    }

    toObject<T>(data: Data | null): T | null {
        return this._serializationService.toObject<T>(data);
    }

    getLocalAddress(): Address {
        return this._localAddress;
    }

    getClusterService(): ClusterServiceView {
        return {
            getMembers: () => [{ address: () => this._localAddress }],
        };
    }
}
