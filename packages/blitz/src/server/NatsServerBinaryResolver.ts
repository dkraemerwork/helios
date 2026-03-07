import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// N16 FIX: use createRequire for ESM-safe require.resolve
const _require = createRequire(import.meta.url);

export class NatsServerNotFoundError extends Error {
    constructor() {
        super(
            'nats-server binary not found. Install it with:\n' +
            '  bun add nats-server   (recommended — adds to package.json)\n' +
            '  brew install nats-server   (macOS system-wide)\n' +
            'Or set embedded.binaryPath in BlitzService.start() config.',
        );
        this.name = 'NatsServerNotFoundError';
    }
}

export class NatsServerBinaryResolver {
    /** @internal — exposed for testing only */
    static _resolveFromNpm: () => string | undefined = () => {
        try {
            const resolved = _require.resolve('nats-server/bin/nats-server');
            // N6 FIX: verify file actually exists on disk
            if (existsSync(resolved)) return resolved;
        } catch { /* package not installed */ }
        return undefined;
    };

    /** @internal — exposed for testing only */
    static _resolveFromPath: () => string | undefined = () => {
        return Bun.which('nats-server') ?? undefined;
    };

    static resolve(binaryPath?: string): string {
        if (binaryPath) return binaryPath;

        const fromNpm = NatsServerBinaryResolver._resolveFromNpm();
        if (fromNpm) return fromNpm;

        const fromPath = NatsServerBinaryResolver._resolveFromPath();
        if (fromPath) return fromPath;

        throw new NatsServerNotFoundError();
    }
}
