import { type HeliosBlitzService } from './HeliosBlitzService.js';

/**
 * Fence-aware wrapper that blocks access to the Helios-owned Blitz instance
 * until the Block 18.3 pre-cutover readiness fence has cleared.
 *
 * Used by the NestJS bridge to ensure no Blitz-facing integration surface
 * can expose or reuse the Helios-owned Blitz instance before authoritative
 * topology is applied and post-cutover JetStream readiness is green.
 */
export class FenceAwareBlitzProvider {
    private readonly _fenceCheck: () => boolean;
    private readonly _service: HeliosBlitzService | null;

    constructor(fenceCheck: () => boolean, service: HeliosBlitzService | null) {
        this._fenceCheck = fenceCheck;
        this._service = service;
    }

    /**
     * Returns the underlying HeliosBlitzService if the readiness fence has cleared.
     * Throws if the fence is still active (pre-cutover, stale, or retryable state).
     */
    getService(): HeliosBlitzService {
        if (!this._fenceCheck()) {
            throw new Error(
                'Blitz service is not available: pre-cutover readiness fence has not cleared. ' +
                'Authoritative topology must be applied and post-cutover JetStream readiness must be green.',
            );
        }
        if (!this._service) {
            throw new Error('Blitz service is not initialized.');
        }
        return this._service;
    }

    /**
     * Check whether the fence has cleared without throwing.
     */
    isAvailable(): boolean {
        return this._fenceCheck() && this._service !== null;
    }
}
