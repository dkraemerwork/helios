/**
 * TursoStoreService — session management backed by Turso/libSQL via MapStore.
 *
 * The 'sessions' IMap has a TursoMapStore configured in main.ts.
 * All operations go through the distributed map, which transparently
 * persists to a SQLite-compatible Turso database:
 *
 *   put(key, value)  → write-through to Turso (INSERT OR REPLACE)
 *   get(key)         → read-through from Turso on cache miss
 *   remove(key)      → delete-through from Turso
 *
 * Real-world scenario: session management for a web application. Sessions
 * are kept in Helios for microsecond-fast lookups but persist across restarts
 * via Turso. Uses in-memory SQLite (':memory:') for this demo, but easily
 * switches to Turso cloud ('libsql://...') or local file ('file:./sessions.db').
 */

import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { InjectMap } from '@zenystx/helios-nestjs';
import type { IMap } from '@zenystx/helios-core/map/IMap';

export interface Session {
    sessionId: string;
    userId: string;
    ipAddress: string;
    userAgent: string;
    createdAt: string;
    expiresAt: string;
    isActive: boolean;
}

@Injectable()
export class TursoStoreService {
    constructor(
        @InjectMap('sessions') private readonly sessions: IMap<string, Session>,
    ) {}

    /** Create a new session (write-through to Turso). */
    async createSession(session: Session): Promise<void> {
        await this.sessions.put(session.sessionId, session);
    }

    /** Get a session by ID (read-through from Turso on miss). */
    async getSession(sessionId: string): Promise<Session | null> {
        return this.sessions.get(sessionId);
    }

    /** Invalidate (remove) a session (delete-through from Turso). */
    async invalidateSession(sessionId: string): Promise<Session | null> {
        return this.sessions.remove(sessionId);
    }

    /** Seed sample sessions. */
    async seed(): Promise<void> {
        const now = new Date();
        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
        const sessions: Session[] = [
            {
                sessionId: 'sess-abc123',
                userId: 'u1',
                ipAddress: '192.168.1.42',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                createdAt: now.toISOString(),
                expiresAt: oneHourLater,
                isActive: true,
            },
            {
                sessionId: 'sess-def456',
                userId: 'u2',
                ipAddress: '10.0.0.15',
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                createdAt: now.toISOString(),
                expiresAt: oneHourLater,
                isActive: true,
            },
            {
                sessionId: 'sess-ghi789',
                userId: 'u3',
                ipAddress: '172.16.0.8',
                userAgent: 'Mozilla/5.0 (Linux; Android 14)',
                createdAt: now.toISOString(),
                expiresAt: oneHourLater,
                isActive: true,
            },
        ];
        for (const s of sessions) {
            await this.createSession(s);
        }
    }

    /** Run the Turso MapStore demo showing write-through and read-through. */
    async runDemo(): Promise<void> {
        console.log('  Creating 3 sessions (write-through to Turso/libSQL)...');
        await this.seed();
        console.log(`  Map size after seeding: ${this.sessions.size()}`);

        // Read-through: retrieve sessions
        const sess1 = await this.getSession('sess-abc123');
        console.log(`\n  get('sess-abc123') → user=${sess1?.userId}, ip=${sess1?.ipAddress}`);
        console.log(`    UA: ${sess1?.userAgent}`);
        console.log(`    Active: ${sess1?.isActive} | Expires: ${sess1?.expiresAt}`);

        const sess2 = await this.getSession('sess-def456');
        console.log(`\n  get('sess-def456') → user=${sess2?.userId}, ip=${sess2?.ipAddress}`);
        console.log(`    Active: ${sess2?.isActive}`);

        // Update session (write-through) — simulate marking inactive
        if (sess2) {
            const deactivated: Session = { ...sess2, isActive: false };
            await this.createSession(deactivated);
            const reloaded = await this.getSession('sess-def456');
            console.log(`\n  Deactivated session 'sess-def456' → active=${reloaded?.isActive} (write-through to Turso)`);
        }

        // Invalidate a session (delete-through)
        const removed = await this.invalidateSession('sess-ghi789');
        console.log(`\n  Invalidated session 'sess-ghi789' for user '${removed?.userId}' (delete-through from Turso)`);
        console.log(`  Map size after invalidation: ${this.sessions.size()}`);

        // Verify removal
        const ghost = await this.getSession('sess-ghi789');
        console.log(`  get('sess-ghi789') after invalidation → ${ghost ?? 'null'} (confirmed deleted)`);
    }
}
