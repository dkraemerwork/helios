/**
 * Mapping Registry — CREATE/DROP MAPPING support.
 *
 * Mirrors the Hazelcast SQL mapping concept: an explicit schema declaration
 * that associates a logical name with an IMap and defines its column layout.
 */
import type { SqlColumnType } from '@zenystx/helios-core/sql/impl/SqlRowMetadata.js';

export interface MappingColumn {
    readonly name: string;
    readonly type: SqlColumnType;
    readonly externalName?: string;  // maps to field in the value object
}

export interface MappingConfig {
    readonly name: string;
    readonly type: 'IMap';
    readonly columns: MappingColumn[];
    readonly options: Record<string, string>;
}

export class MappingAlreadyExistsError extends Error {
    constructor(name: string) {
        super(`Mapping '${name}' already exists`);
        this.name = 'MappingAlreadyExistsError';
    }
}

export class MappingNotFoundError extends Error {
    constructor(name: string) {
        super(`Mapping '${name}' does not exist`);
        this.name = 'MappingNotFoundError';
    }
}

export class MappingRegistry {
    private readonly _mappings = new Map<string, MappingConfig>();

    /**
     * Register a new mapping. Throws if a mapping with the same name already exists.
     */
    createMapping(config: MappingConfig): void {
        const key = config.name.toLowerCase();
        if (this._mappings.has(key)) {
            throw new MappingAlreadyExistsError(config.name);
        }
        this._mappings.set(key, config);
    }

    /**
     * Register a mapping if it does not already exist.
     * Returns true if created, false if it already existed.
     */
    createMappingIfNotExists(config: MappingConfig): boolean {
        const key = config.name.toLowerCase();
        if (this._mappings.has(key)) return false;
        this._mappings.set(key, config);
        return true;
    }

    /**
     * Remove a mapping by name. Throws if it does not exist.
     */
    dropMapping(name: string): void {
        const key = name.toLowerCase();
        if (!this._mappings.has(key)) {
            throw new MappingNotFoundError(name);
        }
        this._mappings.delete(key);
    }

    /**
     * Remove a mapping if it exists; does nothing if it does not.
     * Returns true if dropped, false if it did not exist.
     */
    dropMappingIfExists(name: string): boolean {
        const key = name.toLowerCase();
        return this._mappings.delete(key);
    }

    /** Returns the MappingConfig for the given name, or null if not found. */
    getMapping(name: string): MappingConfig | null {
        return this._mappings.get(name.toLowerCase()) ?? null;
    }

    /** Returns all registered mappings. */
    listMappings(): MappingConfig[] {
        return [...this._mappings.values()];
    }
}
