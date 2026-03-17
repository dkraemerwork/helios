/**
 * Checkpoint/snapshot for fast recovery.
 * Writes the current state of all map data to a snapshot file.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface CheckpointMetadata {
    readonly walSequence: bigint;
    readonly timestamp: number;
    readonly mapCount: number;
    readonly entryCount: number;
}

export class Checkpoint {
    private readonly _dir: string;

    constructor(dir: string) {
        this._dir = dir;
    }

    /**
     * Write a checkpoint of all map data.
     * Format: JSON lines — each line is a {m: mapName, p: partitionId, k: key (base64), v: value (base64)} record.
     */
    async write(
        walSequence: bigint,
        entries: Iterable<{ mapName: string; partitionId: number; key: Uint8Array; value: Uint8Array }>,
    ): Promise<CheckpointMetadata> {
        await fs.promises.mkdir(this._dir, { recursive: true });

        const timestamp = Date.now();
        const checkpointFile = path.join(this._dir, `checkpoint-${timestamp}.jsonl`);
        const metaFile = path.join(this._dir, `checkpoint-${timestamp}.meta.json`);

        let entryCount = 0;
        const mapNames = new Set<string>();
        const lines: string[] = [];

        for (const entry of entries) {
            mapNames.add(entry.mapName);
            lines.push(JSON.stringify({
                m: entry.mapName,
                p: entry.partitionId,
                k: Buffer.from(entry.key).toString('base64'),
                v: Buffer.from(entry.value).toString('base64'),
            }));
            entryCount++;
        }

        await fs.promises.writeFile(checkpointFile, lines.join('\n') + '\n');

        const metadata: CheckpointMetadata = {
            walSequence,
            timestamp,
            mapCount: mapNames.size,
            entryCount,
        };

        await fs.promises.writeFile(metaFile, JSON.stringify({
            ...metadata,
            walSequence: metadata.walSequence.toString(),
        }, null, 2));

        return metadata;
    }

    /**
     * Read the latest checkpoint. Returns entries and metadata, or null if no checkpoint exists.
     */
    async readLatest(): Promise<{
        metadata: CheckpointMetadata;
        entries: Array<{ mapName: string; partitionId: number; key: Uint8Array; value: Uint8Array }>;
    } | null> {
        if (!fs.existsSync(this._dir)) return null;

        const files = await fs.promises.readdir(this._dir);
        const metaFiles = files.filter(f => f.endsWith('.meta.json')).sort();
        if (metaFiles.length === 0) return null;

        const latestMeta = metaFiles[metaFiles.length - 1];
        const metaContent = JSON.parse(await fs.promises.readFile(path.join(this._dir, latestMeta), 'utf-8'));
        const metadata: CheckpointMetadata = {
            walSequence: BigInt(metaContent.walSequence),
            timestamp: metaContent.timestamp,
            mapCount: metaContent.mapCount,
            entryCount: metaContent.entryCount,
        };

        const dataFile = latestMeta.replace('.meta.json', '.jsonl');
        const dataPath = path.join(this._dir, dataFile);
        if (!fs.existsSync(dataPath)) return { metadata, entries: [] };

        const content = await fs.promises.readFile(dataPath, 'utf-8');
        const entries = content.split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => {
                const obj = JSON.parse(line);
                return {
                    mapName: obj.m as string,
                    partitionId: obj.p as number,
                    key: new Uint8Array(Buffer.from(obj.k, 'base64')),
                    value: new Uint8Array(Buffer.from(obj.v, 'base64')),
                };
            });

        return { metadata, entries };
    }

    /** Clean up old checkpoints, keeping only the N most recent. */
    async cleanup(keepCount: number = 2): Promise<void> {
        if (!fs.existsSync(this._dir)) return;
        const files = await fs.promises.readdir(this._dir);
        const metaFiles = files.filter(f => f.endsWith('.meta.json')).sort();

        if (metaFiles.length <= keepCount) return;

        const toRemove = metaFiles.slice(0, metaFiles.length - keepCount);
        for (const metaFile of toRemove) {
            const dataFile = metaFile.replace('.meta.json', '.jsonl');
            await fs.promises.unlink(path.join(this._dir, metaFile)).catch(() => {});
            await fs.promises.unlink(path.join(this._dir, dataFile)).catch(() => {});
        }
    }
}
