/**
 * Loads a HeliosConfig from a JSON or YAML file.
 *
 * Supported formats:
 *   - .json  — JSON object
 *   - .yml / .yaml — YAML document
 *
 * File schema:
 * ```yaml
 * name: my-cluster          # optional, defaults to 'helios'
 * maps:                     # optional list of MapConfig entries
 *   - name: orders
 *     ttlSeconds: 300
 *     backupCount: 2
 * ```
 */
import { HeliosConfig } from '@helios/config/HeliosConfig';
import { MapConfig } from '@helios/config/MapConfig';

/**
 * Loads and parses a config file, returning a HeliosConfig.
 * @throws Error if the file is not found, has an unsupported extension, or fails validation.
 */
export async function loadConfig(filePath: string): Promise<HeliosConfig> {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
        throw new Error(`Config file not found: ${filePath}`);
    }

    const content = await file.text();
    let raw: unknown;

    if (filePath.endsWith('.json')) {
        try {
            raw = JSON.parse(content);
        } catch (e) {
            throw new Error(`Failed to parse JSON config file "${filePath}": ${String(e)}`);
        }
    } else if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
        try {
            raw = Bun.YAML.parse(content);
        } catch (e) {
            throw new Error(`Failed to parse YAML config file "${filePath}": ${String(e)}`);
        }
    } else {
        const ext = filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')) : '(no extension)';
        throw new Error(`Unsupported config file format: "${ext}". Use .json or .yml/.yaml`);
    }

    return parseRawConfig(raw);
}

/**
 * Parses a raw (deserialized) config object into a HeliosConfig.
 * @throws Error with a descriptive message if validation fails.
 */
export function parseRawConfig(raw: unknown): HeliosConfig {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('Config must be an object');
    }

    const obj = raw as Record<string, unknown>;

    // --- instance name ---
    const name: string = (typeof obj['name'] === 'string') ? obj['name'] : 'helios';
    if (name.trim() === '') {
        throw new Error('Instance name must not be empty');
    }

    const config = new HeliosConfig(name);

    // --- map configs ---
    if ('maps' in obj && obj['maps'] !== undefined) {
        if (!Array.isArray(obj['maps'])) {
            throw new Error('"maps" must be an array');
        }
        for (const entry of obj['maps'] as unknown[]) {
            config.addMapConfig(parseMapConfig(entry));
        }
    }

    return config;
}

function parseMapConfig(entry: unknown): MapConfig {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('Each map entry must be an object');
    }

    const e = entry as Record<string, unknown>;

    if (typeof e['name'] !== 'string' || (e['name'] as string).trim() === '') {
        throw new Error('Each map config entry must have a non-empty "name" field');
    }

    const mc = new MapConfig(e['name'] as string);

    if (typeof e['ttlSeconds'] === 'number') {
        mc.setTimeToLiveSeconds(e['ttlSeconds'] as number);
    }
    if (typeof e['backupCount'] === 'number') {
        mc.setBackupCount(e['backupCount'] as number);
    }
    if (typeof e['asyncBackupCount'] === 'number') {
        mc.setAsyncBackupCount(e['asyncBackupCount'] as number);
    }
    if (typeof e['maxIdleSeconds'] === 'number') {
        mc.setMaxIdleSeconds(e['maxIdleSeconds'] as number);
    }
    if (typeof e['statisticsEnabled'] === 'boolean') {
        mc.setStatisticsEnabled(e['statisticsEnabled'] as boolean);
    }
    if (typeof e['readBackupData'] === 'boolean') {
        mc.setReadBackupData(e['readBackupData'] as boolean);
    }

    return mc;
}
