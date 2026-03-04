import { describe, expect, it } from 'bun:test';
import { NatsServerBinaryResolver, NatsServerNotFoundError } from '../../src/server/NatsServerBinaryResolver.js';

describe('NatsServerBinaryResolver', () => {
    it('resolve_withExplicitPath_returnsIt', () => {
        const result = NatsServerBinaryResolver.resolve('/custom/path/nats-server');
        expect(result).toBe('/custom/path/nats-server');
    });

    it('resolve_withNpmPackage_returnsNpmBinaryPath', () => {
        // Mock npm resolution to return a valid path
        const originalNpm = NatsServerBinaryResolver._resolveFromNpm;
        NatsServerBinaryResolver._resolveFromNpm = () => '/mock/node_modules/nats-server/bin/nats-server';

        try {
            const result = NatsServerBinaryResolver.resolve();
            expect(result).toContain('nats-server');
            expect(result).toBe('/mock/node_modules/nats-server/bin/nats-server');
        } finally {
            NatsServerBinaryResolver._resolveFromNpm = originalNpm;
        }
    });

    it('resolve_withNoBinary_throwsNatsServerNotFoundError', () => {
        const originalNpm = NatsServerBinaryResolver._resolveFromNpm;
        const originalPath = NatsServerBinaryResolver._resolveFromPath;

        NatsServerBinaryResolver._resolveFromNpm = () => undefined;
        NatsServerBinaryResolver._resolveFromPath = () => undefined;

        try {
            expect(() => NatsServerBinaryResolver.resolve()).toThrow(NatsServerNotFoundError);
            expect(() => NatsServerBinaryResolver.resolve()).toThrow(/bun add nats-server/);
        } finally {
            NatsServerBinaryResolver._resolveFromNpm = originalNpm;
            NatsServerBinaryResolver._resolveFromPath = originalPath;
        }
    });

    it('resolve_withNpmPackageButMissingFile_fallsThroughToPath', () => {
        // N6 test: npm package installed but binary file missing on disk
        // _resolveFromNpm returns undefined (existsSync fails inside), falls through to PATH
        const originalNpm = NatsServerBinaryResolver._resolveFromNpm;
        const originalPath = NatsServerBinaryResolver._resolveFromPath;

        NatsServerBinaryResolver._resolveFromNpm = () => undefined;
        NatsServerBinaryResolver._resolveFromPath = () => '/usr/local/bin/nats-server';

        try {
            const result = NatsServerBinaryResolver.resolve();
            expect(result).toBe('/usr/local/bin/nats-server');
        } finally {
            NatsServerBinaryResolver._resolveFromNpm = originalNpm;
            NatsServerBinaryResolver._resolveFromPath = originalPath;
        }
    });

    it('NatsServerNotFoundError has actionable install instructions', () => {
        const error = new NatsServerNotFoundError();
        expect(error.name).toBe('NatsServerNotFoundError');
        expect(error.message).toContain('bun add nats-server');
        expect(error.message).toContain('brew install nats-server');
        expect(error.message).toContain('binaryPath');
        expect(error).toBeInstanceOf(Error);
    });

    it('resolve_npmResolvePrecedesPath', () => {
        // npm resolution takes precedence over PATH
        const originalNpm = NatsServerBinaryResolver._resolveFromNpm;
        const originalPath = NatsServerBinaryResolver._resolveFromPath;

        NatsServerBinaryResolver._resolveFromNpm = () => '/npm/nats-server';
        NatsServerBinaryResolver._resolveFromPath = () => '/path/nats-server';

        try {
            expect(NatsServerBinaryResolver.resolve()).toBe('/npm/nats-server');
        } finally {
            NatsServerBinaryResolver._resolveFromNpm = originalNpm;
            NatsServerBinaryResolver._resolveFromPath = originalPath;
        }
    });

    it('resolve_npmFailsButPathExists_returnsPathBinary', () => {
        const originalNpm = NatsServerBinaryResolver._resolveFromNpm;
        const originalPath = NatsServerBinaryResolver._resolveFromPath;

        NatsServerBinaryResolver._resolveFromNpm = () => undefined;
        NatsServerBinaryResolver._resolveFromPath = () => '/opt/homebrew/bin/nats-server';

        try {
            expect(NatsServerBinaryResolver.resolve()).toBe('/opt/homebrew/bin/nats-server');
        } finally {
            NatsServerBinaryResolver._resolveFromNpm = originalNpm;
            NatsServerBinaryResolver._resolveFromPath = originalPath;
        }
    });

    it('resolve_explicitPathTakesPrecedenceOverAll', () => {
        const originalNpm = NatsServerBinaryResolver._resolveFromNpm;
        const originalPath = NatsServerBinaryResolver._resolveFromPath;

        NatsServerBinaryResolver._resolveFromNpm = () => '/npm/nats-server';
        NatsServerBinaryResolver._resolveFromPath = () => '/path/nats-server';

        try {
            expect(NatsServerBinaryResolver.resolve('/explicit/nats-server')).toBe('/explicit/nats-server');
        } finally {
            NatsServerBinaryResolver._resolveFromNpm = originalNpm;
            NatsServerBinaryResolver._resolveFromPath = originalPath;
        }
    });
});
