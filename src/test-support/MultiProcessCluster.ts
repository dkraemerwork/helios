/**
 * Multi-process Helios cluster test harness.
 *
 * Spawns Helios member instances as separate Bun child processes communicating
 * over real TCP via TcpClusterTransport. Provides IPC-based command/query/fault
 * injection for Block 21.4 multi-process proof testing.
 */
import { Subprocess } from 'bun';
import { resolve } from 'path';

const WORKER_PATH = resolve(import.meta.dir, 'helios-member-worker.ts');

interface ProvenanceRecord {
    memberId: string;
    partitionId: number;
    replicaRole: 'PRIMARY' | 'BACKUP' | 'UNKNOWN';
    partitionEpoch: number;
    operationKind: string;
    keys: string[];
    ts: number;
}

interface MemberHandle {
    name: string;
    port: number;
    proc: Subprocess;
    pending: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>;
    msgId: number;
}

export class MultiProcessCluster {
    private readonly _members = new Map<string, MemberHandle>();

    /**
     * Starts a new Helios member in a separate Bun child process.
     */
    async startMember(opts: {
        name: string;
        port: number;
        peerPorts: number[];
        mapName: string;
        writeMode: 'write-through' | 'write-behind';
        writeDelaySeconds?: number;
        writeBatchSize?: number;
        writeCoalescing?: boolean;
        initialLoadMode?: 'EAGER' | 'LAZY';
        seedData?: Record<string, string>;
    }): Promise<void> {
        const proc = Bun.spawn(['bun', 'run', WORKER_PATH], {
            stdio: ['pipe', 'pipe', 'pipe'],
            ipc: (message: any) => this._handleIpcMessage(opts.name, message),
        });

        const handle: MemberHandle = {
            name: opts.name,
            port: opts.port,
            proc,
            pending: new Map(),
            msgId: 0,
        };
        this._members.set(opts.name, handle);

        // Reject all pending IPC messages when the process exits unexpectedly
        proc.exited.then(() => {
            for (const [, p] of handle.pending) {
                p.reject(new Error(`Process exited: ${opts.name}`));
            }
            handle.pending.clear();
        });

        // Wait for worker ready signal
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Worker ready timeout')), 10000);
            // The IPC handler is already set via the ipc callback.
            // Use a pending entry with special ID to receive the ready signal.
            handle.pending.set('__ready__', { resolve: () => { clearTimeout(timeout); resolve(); }, reject });
        });

        // Send start command
        await this._send(opts.name, {
            type: 'start',
            name: opts.name,
            port: opts.port,
            peerPorts: opts.peerPorts,
            mapName: opts.mapName,
            writeMode: opts.writeMode,
            writeDelaySeconds: opts.writeDelaySeconds,
            writeBatchSize: opts.writeBatchSize,
            writeCoalescing: opts.writeCoalescing,
            initialLoadMode: opts.initialLoadMode,
            seedData: opts.seedData,
        });
    }

    /**
     * Wait until a member reports the given cluster size.
     */
    async waitForClusterSize(memberName: string, size: number, timeoutMs = 10000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const result = await this._send(memberName, {
                type: 'query',
                query: 'clusterSize',
            });
            if (result.size === size) return;
            await Bun.sleep(50);
        }
        throw new Error(`Cluster size timeout: ${memberName} did not reach ${size}`);
    }

    /**
     * Execute a map command on a member.
     */
    async mapPut(memberName: string, mapName: string, key: string, value: string): Promise<void> {
        await this._send(memberName, {
            type: 'command',
            command: 'put',
            mapName,
            key,
            value,
        });
    }

    async mapGet(memberName: string, mapName: string, key: string): Promise<string | null> {
        const result = await this._send(memberName, {
            type: 'command',
            command: 'get',
            mapName,
            key,
        });
        return result.value;
    }

    async mapRemove(memberName: string, mapName: string, key: string): Promise<void> {
        await this._send(memberName, {
            type: 'command',
            command: 'remove',
            mapName,
            key,
        });
    }

    async mapPutAll(memberName: string, mapName: string, entries: [string, string][]): Promise<void> {
        await this._send(memberName, {
            type: 'command',
            command: 'putAll',
            mapName,
            entries,
        });
    }

    async mapGetAll(memberName: string, mapName: string, keys: string[]): Promise<Map<string, string>> {
        const result = await this._send(memberName, {
            type: 'command',
            command: 'getAll',
            mapName,
            keys,
        });
        return new Map(result.entries);
    }

    async mapClear(memberName: string, mapName: string): Promise<void> {
        await this._send(memberName, {
            type: 'command',
            command: 'clear',
            mapName,
        });
    }

    async mapSize(memberName: string, mapName: string): Promise<number> {
        const result = await this._send(memberName, {
            type: 'command',
            command: 'size',
            mapName,
        });
        return result.size;
    }

    /**
     * Get provenance records from a member's adapter.
     */
    async getProvenance(memberName: string): Promise<ProvenanceRecord[]> {
        const result = await this._send(memberName, {
            type: 'query',
            query: 'provenance',
        });
        return result.records;
    }

    /**
     * Reset provenance records on a member.
     */
    async resetProvenance(memberName: string): Promise<void> {
        await this._send(memberName, { type: 'resetProvenance' });
    }

    /**
     * Query partition ownership for a key.
     */
    async getPartitionOwner(memberName: string, key: string): Promise<{ partitionId: number; owner: string | null }> {
        return this._send(memberName, {
            type: 'query',
            query: 'partitionOwner',
            key,
        });
    }

    /**
     * Get adapter backing data from a member.
     */
    async getStoreData(memberName: string): Promise<Map<string, string>> {
        const result = await this._send(memberName, {
            type: 'query',
            query: 'storeData',
        });
        return new Map(result.data);
    }

    /**
     * Find a key owned by a specific member.
     */
    async findKeyOwnedBy(queryMember: string, ownerName: string, prefix = 'k'): Promise<string> {
        for (let i = 0; i < 1000; i++) {
            const key = `${prefix}-${i}`;
            const info = await this.getPartitionOwner(queryMember, key);
            if (info.owner === ownerName) return key;
        }
        throw new Error(`Could not find key owned by ${ownerName}`);
    }

    /**
     * Kill a member process (simulates crash — no graceful shutdown).
     */
    killMember(memberName: string): void {
        const handle = this._members.get(memberName);
        if (!handle) throw new Error(`Unknown member: ${memberName}`);
        try { handle.proc.kill(); } catch {}
        this._members.delete(memberName);
    }

    /**
     * Gracefully shut down a member.
     */
    async shutdownMember(memberName: string): Promise<void> {
        try {
            await this._send(memberName, { type: 'shutdown' }, 3000);
        } catch {
            // If IPC fails, force kill
            this.killMember(memberName);
        }
    }

    /**
     * Shut down all members.
     */
    async shutdownAll(): Promise<void> {
        const names = [...this._members.keys()];
        await Promise.allSettled(names.map(n => this.shutdownMember(n)));
        // Wait for processes to exit
        await Bun.sleep(200);
        // Force kill any remaining
        for (const handle of this._members.values()) {
            try { handle.proc.kill(); } catch {}
        }
        this._members.clear();
    }

    // ═══════════════════════════════════════════════════════════
    //  IPC internals
    // ═══════════════════════════════════════════════════════════

    private _handleIpcMessage(memberName: string, message: any): void {
        const handle = this._members.get(memberName);
        if (!handle) return;

        // Handle ready signal
        if (message.type === 'ready') {
            const readyPending = handle.pending.get('__ready__');
            if (readyPending) {
                handle.pending.delete('__ready__');
                readyPending.resolve(undefined);
            }
            return;
        }

        // Handle response to a pending request
        const id = message.id;
        if (id && handle.pending.has(id)) {
            const { resolve, reject } = handle.pending.get(id)!;
            handle.pending.delete(id);
            if (message.error) {
                reject(new Error(`[${memberName}] ${message.error}`));
            } else {
                resolve(message.result);
            }
        }
    }

    private _send(memberName: string, msg: any, timeoutMs = 30000): Promise<any> {
        const handle = this._members.get(memberName);
        if (!handle) return Promise.reject(new Error(`Unknown member: ${memberName}`));

        const id = `msg-${++handle.msgId}`;
        msg.id = id;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                handle.pending.delete(id);
                reject(new Error(`IPC timeout: ${memberName} ${msg.type}/${msg.command ?? msg.query ?? ''}`));
            }, timeoutMs);

            handle.pending.set(id, {
                resolve: (v: any) => { clearTimeout(timeout); resolve(v); },
                reject: (e: Error) => { clearTimeout(timeout); reject(e); },
            });

            try {
                handle.proc.send(msg);
            } catch {
                handle.pending.delete(id);
                clearTimeout(timeout);
                reject(new Error(`IPC send failed (process exited): ${memberName}`));
            }
        });
    }
}
