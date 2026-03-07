/**
 * Client-side listener registration and event dispatch service.
 *
 * Port of {@code com.hazelcast.client.impl.spi.impl.listener.ClientListenerServiceImpl}.
 */
import type { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";

export interface ListenerMessageCodec {
    encodeAddRequest(): ClientMessage | null;
    decodeAddResponse(msg: ClientMessage | null): string;
    encodeRemoveRequest(registrationId: string): ClientMessage | null;
}

export type ClientEventHandler = (msg: ClientMessage) => void;

interface ListenerRegistration {
    id: string;
    codec: ListenerMessageCodec;
    handler: ClientEventHandler;
    serverRegistrationId: string | null;
}

let _regCounter = 0;

export class ClientListenerService {
    private readonly _registrations = new Map<string, ListenerRegistration>();
    private readonly _eventHandlers = new Map<number, ClientEventHandler>();

    registerListener(
        codec: ListenerMessageCodec,
        handler: ClientEventHandler,
    ): string {
        const id = `listener-reg-${++_regCounter}-${Date.now()}`;
        const serverRegId = codec.decodeAddResponse(null);
        this._registrations.set(id, {
            id,
            codec,
            handler,
            serverRegistrationId: serverRegId,
        });
        return id;
    }

    deregisterListener(registrationId: string): boolean {
        return this._registrations.delete(registrationId);
    }

    addEventHandler(correlationId: number, handler: ClientEventHandler): void {
        this._eventHandlers.set(correlationId, handler);
    }

    removeEventHandler(correlationId: number): void {
        this._eventHandlers.delete(correlationId);
    }

    handleEventMessage(msg: ClientMessage): void {
        const correlationId = msg.getCorrelationId();
        const handler = this._eventHandlers.get(correlationId);
        if (handler) {
            handler(msg);
        }
    }

    getPendingReRegistrations(): ListenerRegistration[] {
        return [...this._registrations.values()];
    }

    getRegistrationCount(): number {
        return this._registrations.size;
    }

    shutdown(): void {
        this._registrations.clear();
        this._eventHandlers.clear();
    }
}
