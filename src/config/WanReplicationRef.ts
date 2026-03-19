/**
 * WAN replication reference attached to a MapConfig.
 *
 * Port of {@code com.hazelcast.config.WanReplicationRef}.
 * Links a map to a named WanReplicationConfig and specifies
 * the merge policy to use when applying incoming WAN events.
 */
export class WanReplicationRef {
    static readonly DEFAULT_MERGE_POLICY_CLASS_NAME = 'PassThroughMergePolicy';
    static readonly DEFAULT_REPUBLISHING_ENABLED = false;

    private _name: string = '';
    private _mergePolicyClassName: string = WanReplicationRef.DEFAULT_MERGE_POLICY_CLASS_NAME;
    private _republishingEnabled: boolean = WanReplicationRef.DEFAULT_REPUBLISHING_ENABLED;

    constructor(name?: string) {
        if (name !== undefined) {
            this._name = name;
        }
    }

    /**
     * Returns the name of the WanReplicationConfig this ref points to.
     */
    getName(): string {
        return this._name;
    }

    setName(name: string): this {
        this._name = name;
        return this;
    }

    /**
     * Returns the merge policy class name to apply when incoming WAN events
     * conflict with existing local entries.
     * Defaults to {@code 'PassThroughMergePolicy'} — incoming always wins.
     */
    getMergePolicyClassName(): string {
        return this._mergePolicyClassName;
    }

    setMergePolicyClassName(className: string): this {
        this._mergePolicyClassName = className;
        return this;
    }

    /**
     * When true, this member re-publishes incoming WAN events to its own
     * WAN publisher pipeline (daisy-chain/hub-spoke topologies).
     */
    isRepublishingEnabled(): boolean {
        return this._republishingEnabled;
    }

    setRepublishingEnabled(enabled: boolean): this {
        this._republishingEnabled = enabled;
        return this;
    }
}
