/**
 * Public factory for creating Helios instances.
 *
 * ```typescript
 * const hz = await Helios.newInstance();                     // default config
 * const hz = await Helios.newInstance(config);               // explicit HeliosConfig
 * const hz = await Helios.newInstance('helios-config.json'); // file-based JSON
 * const hz = await Helios.newInstance('helios-config.yml');  // file-based YAML
 * ```
 *
 * Port of com.hazelcast.core.Hazelcast.
 */
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { loadConfig } from '@zenystx/helios-core/config/ConfigLoader';

export class Helios {
    /** Registry of all live instances keyed by instance name. */
    private static readonly _instances = new Map<string, HeliosInstanceImpl>();

    // Not instantiable
    private constructor() {}

    /**
     * Creates a new Helios instance.
     *
     * @param configOrFile
     *   - omitted: use the default HeliosConfig (name = 'helios')
     *   - HeliosConfig: use the supplied config
     *   - string (file path): load config from a .json or .yml/.yaml file
     */
    static async newInstance(configOrFile?: HeliosConfig | string): Promise<HeliosInstanceImpl> {
        let config: HeliosConfig;

        if (typeof configOrFile === 'string') {
            config = await loadConfig(configOrFile);
        } else if (configOrFile instanceof HeliosConfig) {
            config = configOrFile;
        } else {
            config = new HeliosConfig();
        }

        const instance = new HeliosInstanceImpl(config);
        Helios._instances.set(instance.getName(), instance);
        return instance;
    }

    /**
     * Shuts down all Helios instances created by this factory on the current runtime.
     */
    static shutdownAll(): void {
        for (const instance of Helios._instances.values()) {
            if (instance.isRunning()) {
                instance.shutdown();
            }
        }
        Helios._instances.clear();
    }

    /**
     * Returns all currently tracked (live or shut-down) instances.
     * Instances are removed from this map only after {@link shutdownAll}.
     */
    static getAllInstances(): ReadonlyMap<string, HeliosInstanceImpl> {
        return Helios._instances;
    }

    /**
     * Returns the instance registered under the given name, or null.
     */
    static getInstanceByName(name: string): HeliosInstanceImpl | null {
        return Helios._instances.get(name) ?? null;
    }
}
