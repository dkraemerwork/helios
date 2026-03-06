/**
 * Port of {@code com.hazelcast.spi.impl.NodeEngine}.
 *
 * Central dependency-injection façade for all SPI services.
 * Injected into every ManagedService at startup.
 *
 * In Helios (single-node in-process), NodeEngineImpl wires all local services.
 * In multi-node mode (Phase 4+), the same interface bridges cluster-aware impls.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';
import type { ILogger } from '@zenystx/helios-core/test-support/ILogger';
import type { OperationService } from '@zenystx/helios-core/spi/impl/operationservice/OperationService';
import type { HeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';
import type { PartitionService } from '@zenystx/helios-core/spi/PartitionService';
import type { Address } from '@zenystx/helios-core/cluster/Address';

/** Minimal cluster service surface exposed through NodeEngine. */
export interface ClusterServiceView {
    getMembers(): ReadonlyArray<{ address(): Address }>;
}

export interface NodeEngine {
    /** Returns the service responsible for executing Operations. */
    getOperationService(): OperationService;

    /** Returns cluster properties (typed property reader). */
    getProperties(): HeliosProperties;

    /** Returns the partition service. */
    getPartitionService(): PartitionService;

    /** Returns the serialization service for toData/toObject conversions. */
    getSerializationService(): SerializationService;

    /** Returns a named logger for this class/name. */
    getLogger(nameOrClass: string | (new (...args: unknown[]) => unknown)): ILogger;

    /** True if this node is running and accepting operations. */
    isRunning(): boolean;

    /** True if node startup has completed (post-join phase). */
    isStartCompleted(): boolean;

    /**
     * Retrieve a registered service by name.
     * @throws HeliosException if the service is not registered.
     */
    getService<T>(serviceName: string): T;

    /**
     * Retrieve a registered service by name, or null if not found.
     */
    getServiceOrNull<T>(serviceName: string): T | null;

    /** Serialize an object to a Data (binary) wrapper. Returns null for null input. */
    toData(obj: unknown): Data | null;

    /** Deserialize a Data wrapper back to a typed object. Returns null for null input. */
    toObject<T>(data: Data | null): T | null;

    /** Returns the local address of this node. */
    getLocalAddress(): Address;

    /** Returns a view of the cluster service for member enumeration. */
    getClusterService(): ClusterServiceView;
}
