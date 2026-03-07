/**
 * Client serialization owner — creates a SerializationServiceImpl
 * owned by the client, used by all request/response paths.
 *
 * Port of the client-side serialization setup from
 * HazelcastClientInstanceImpl.createSerializationService().
 */
import type { ClientConfig } from '@zenystx/helios-core/client/config/ClientConfig';
import { SerializationServiceImpl } from '@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl';

/**
 * Creates the single client-owned serialization service.
 * All client request/response paths must use this instance.
 */
export function createClientSerializationService(config: ClientConfig): SerializationServiceImpl {
    return new SerializationServiceImpl(config.getSerializationConfig());
}
