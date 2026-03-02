/**
 * Tests for CLI argument parsing.
 *
 * Block 7.7: CLI entrypoint + standalone server mode
 */
import { describe, it, expect } from 'bun:test';
import { parseCli } from '@helios/server/cli';

describe('parseCli — defaults', () => {
    it('should return empty object for no args', () => {
        const args = parseCli([]);
        expect(args.configFile).toBeUndefined();
        expect(args.port).toBeUndefined();
        expect(args.help).toBeFalsy();
    });
});

describe('parseCli — --port', () => {
    it('should parse --port 5701', () => {
        const args = parseCli(['--port', '5701']);
        expect(args.port).toBe(5701);
    });

    it('should parse --port 9999', () => {
        const args = parseCli(['--port', '9999']);
        expect(args.port).toBe(9999);
    });

    it('should throw on non-numeric --port', () => {
        expect(() => parseCli(['--port', 'abc'])).toThrow();
    });

    it('should throw on --port with no value', () => {
        expect(() => parseCli(['--port'])).toThrow();
    });

    it('should throw on port out of range (0)', () => {
        expect(() => parseCli(['--port', '0'])).toThrow();
    });

    it('should throw on port out of range (65536)', () => {
        expect(() => parseCli(['--port', '65536'])).toThrow();
    });

    it('should accept port at upper boundary 65535', () => {
        const args = parseCli(['--port', '65535']);
        expect(args.port).toBe(65535);
    });
});

describe('parseCli — --config', () => {
    it('should parse --config helios.yml', () => {
        const args = parseCli(['--config', 'helios.yml']);
        expect(args.configFile).toBe('helios.yml');
    });

    it('should parse --config /abs/path/config.json', () => {
        const args = parseCli(['--config', '/abs/path/config.json']);
        expect(args.configFile).toBe('/abs/path/config.json');
    });

    it('should throw on --config with no value', () => {
        expect(() => parseCli(['--config'])).toThrow();
    });
});

describe('parseCli — --help', () => {
    it('should parse --help flag', () => {
        const args = parseCli(['--help']);
        expect(args.help).toBe(true);
    });

    it('should parse -h flag', () => {
        const args = parseCli(['-h']);
        expect(args.help).toBe(true);
    });
});

describe('parseCli — combinations', () => {
    it('should parse --config + --port together', () => {
        const args = parseCli(['--config', 'helios.yml', '--port', '5701']);
        expect(args.configFile).toBe('helios.yml');
        expect(args.port).toBe(5701);
    });

    it('should parse --port before --config', () => {
        const args = parseCli(['--port', '5702', '--config', 'server.json']);
        expect(args.port).toBe(5702);
        expect(args.configFile).toBe('server.json');
    });

    it('should throw on unknown flag', () => {
        expect(() => parseCli(['--unknown-flag'])).toThrow();
    });
});
