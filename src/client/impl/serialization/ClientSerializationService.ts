/**
 * Client serialization owner — creates a SerializationServiceImpl
 * owned by the client, used by all request/response paths.
 *
 * Port of the client-side serialization setup from
 * HazelcastClientInstanceImpl.createSerializationService().
 */
import type { ClientConfig } from '@zenystx/helios-core/client/config/ClientConfig';
import { HazelcastSerializationService } from '@zenystx/helios-core/internal/serialization/HazelcastSerializationService';

/**
 * Creates the single client-owned serialization service.
 * All client request/response paths must use this instance.
 */
export function createClientSerializationService(config: ClientConfig): HazelcastSerializationService {
    return new HazelcastSerializationService(config.getSerializationConfig());
}
