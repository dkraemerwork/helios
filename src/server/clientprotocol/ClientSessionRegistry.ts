/**
 * Registry of all active client sessions on this member.
 *
 * Port of Hazelcast {@code ClientEndpointManagerImpl}.
 */
import type { ClientSession } from "@zenystx/helios-core/server/clientprotocol/ClientSession";

export class ClientSessionRegistry {
    private readonly _sessions = new Map<string, ClientSession>();

    register(session: ClientSession): void {
        const id = session.getSessionId();
        this._sessions.set(id, session);
    }

    remove(sessionId: string): ClientSession | null {
        const session = this._sessions.get(sessionId) ?? null;
        this._sessions.delete(sessionId);
        return session;
    }

    getSession(sessionId: string): ClientSession | null {
        return this._sessions.get(sessionId) ?? null;
    }

    getSessionByClientUuid(clientUuid: string): ClientSession | null {
        for (const session of this._sessions.values()) {
            if (session.getClientUuid() === clientUuid) return session;
        }
        return null;
    }

    getSessionCount(): number {
        return this._sessions.size;
    }

    getAllSessions(): ClientSession[] {
        return Array.from(this._sessions.values());
    }

    clear(): void {
        for (const session of this._sessions.values()) {
            session.destroy();
        }
        this._sessions.clear();
    }
}
