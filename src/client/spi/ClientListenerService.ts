/**
 * Client-side listener registration and event dispatch service.
 *
 * Port of {@code com.hazelcast.client.impl.spi.impl.listener.ClientListenerServiceImpl}.
 */
import type { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import type { ClientInvocationService } from "@zenystx/helios-core/client/invocation/ClientInvocationService";

export interface ListenerMessageCodec {
    encodeAddRequest(): ClientMessage;
    decodeAddResponse(msg: ClientMessage): string;
    encodeRemoveRequest(registrationId: string): ClientMessage;
    decodeRemoveResponse(msg: ClientMessage): boolean;
}

export type ClientEventHandler = (msg: ClientMessage) => void;

interface ListenerRegistration {
    id: string;
    codec: ListenerMessageCodec;
    handler: ClientEventHandler;
    serverRegistrationId: string | null;
    removed: boolean;
    addRegistrationPromise: Promise<void> | null;
    registrationAttempt: number;
}

let _regCounter = 0;

export class ClientListenerService {
    private readonly _registrations = new Map<string, ListenerRegistration>();
    private readonly _eventHandlers = new Map<number, ClientEventHandler>();
    private _invocationService: ClientInvocationService | null = null;

    setInvocationService(invocationService: ClientInvocationService | null): void {
        this._invocationService = invocationService;
    }

    registerListener(
        codec: ListenerMessageCodec,
        handler: ClientEventHandler,
    ): string {
        const id = `listener-reg-${++_regCounter}-${Date.now()}`;
        const registration: ListenerRegistration = {
            id,
            codec,
            handler,
            serverRegistrationId: null,
            removed: false,
            addRegistrationPromise: null,
            registrationAttempt: 0,
        };
        this._registrations.set(id, registration);
        registration.addRegistrationPromise = this._registerOnServer(registration);
        return id;
    }

    deregisterListener(registrationId: string): boolean {
        const registration = this._registrations.get(registrationId);
        if (registration === undefined) {
            return false;
        }
        registration.removed = true;
        this._registrations.delete(registrationId);
        void this._deregisterOnServer(registration);
        return true;
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
        return [...this._registrations.values()].filter((registration) => !registration.removed);
    }

    getRegistrationCount(): number {
        return this._registrations.size;
    }

    shutdown(): void {
        this._registrations.clear();
        this._eventHandlers.clear();
    }

    reconnectListeners(): void {
        for (const registration of this.getPendingReRegistrations()) {
            this._dropEventHandlerForRegistration(registration);
            registration.serverRegistrationId = null;
            registration.addRegistrationPromise = this._registerOnServer(registration);
        }
    }

    private async _registerOnServer(registration: ListenerRegistration): Promise<void> {
        if (this._invocationService === null || registration.removed) {
            return;
        }
        const attempt = ++registration.registrationAttempt;
        try {
            const request = registration.codec.encodeAddRequest();
            const response = await this._invocationService.invokeOnRandomTarget(request);
            if (registration.removed || attempt !== registration.registrationAttempt) {
                return;
            }
            registration.serverRegistrationId = registration.codec.decodeAddResponse(response);
            this._eventHandlers.set(request.getCorrelationId(), registration.handler);
        } catch {
            if (attempt === registration.registrationAttempt) {
                registration.serverRegistrationId = null;
            }
        }
    }

    private async _deregisterOnServer(registration: ListenerRegistration): Promise<void> {
        await registration.addRegistrationPromise;
        if (registration.serverRegistrationId === null || this._invocationService === null) {
            this._dropEventHandlerForRegistration(registration);
            return;
        }
        try {
            const response = await this._invocationService.invokeOnRandomTarget(
                registration.codec.encodeRemoveRequest(registration.serverRegistrationId),
            );
            registration.codec.decodeRemoveResponse(response);
        } catch {
            // Best-effort cleanup; reconnect will not revive removed registrations.
        } finally {
            this._dropEventHandlerForRegistration(registration);
        }
    }

    private _dropEventHandlerForRegistration(registration: ListenerRegistration): void {
        for (const [correlationId, handler] of this._eventHandlers.entries()) {
            if (handler === registration.handler) {
                this._eventHandlers.delete(correlationId);
            }
        }
    }
}
