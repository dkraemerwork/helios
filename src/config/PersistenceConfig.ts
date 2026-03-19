/**
 * Port of {@code com.hazelcast.config.PersistenceConfig}.
 *
 * Configuration for the WAL-based Hot Restart / disk persistence engine.
 */

export interface EncryptionAtRestConfig {
    /** Whether AES-256-GCM encryption is applied to WAL segments at rest. */
    enabled: boolean;
    /**
     * Encryption key as a hex string (64 hex chars = 32 bytes) or a plain passphrase
     * from which a key is derived via PBKDF2. When using a passphrase, prefix with
     * "passphrase:" to indicate derivation should be used.
     */
    key: string;
}

export class PersistenceConfig {
    static readonly DEFAULT_BASE_DIR = 'helios-persistence';
    static readonly DEFAULT_PARALLELISM = 1;
    static readonly DEFAULT_VALIDATION_TIMEOUT_SECONDS = 120;
    static readonly DEFAULT_DATA_LOAD_TIMEOUT_SECONDS = 900;
    static readonly DEFAULT_REBALANCE_DELAY_SECONDS = 0;

    private _enabled = false;
    private _baseDir: string = PersistenceConfig.DEFAULT_BASE_DIR;
    private _backupDir: string | null = null;
    private _parallelism: number = PersistenceConfig.DEFAULT_PARALLELISM;
    private _validationTimeoutSeconds: number = PersistenceConfig.DEFAULT_VALIDATION_TIMEOUT_SECONDS;
    private _dataLoadTimeoutSeconds: number = PersistenceConfig.DEFAULT_DATA_LOAD_TIMEOUT_SECONDS;
    private _rebalanceDelaySeconds: number = PersistenceConfig.DEFAULT_REBALANCE_DELAY_SECONDS;
    private _autoRemoveStaleData = true;
    private _clusterDataRecoveryPolicy: ClusterDataRecoveryPolicy = 'FULL_RECOVERY_ONLY';
    private _encryptionAtRest: EncryptionAtRestConfig = { enabled: false, key: '' };

    isEnabled(): boolean { return this._enabled; }
    setEnabled(enabled: boolean): this { this._enabled = enabled; return this; }

    getBaseDir(): string { return this._baseDir; }
    setBaseDir(dir: string): this { this._baseDir = dir; return this; }

    getBackupDir(): string | null { return this._backupDir; }
    setBackupDir(dir: string | null): this { this._backupDir = dir; return this; }

    getParallelism(): number { return this._parallelism; }
    setParallelism(parallelism: number): this { this._parallelism = Math.max(1, parallelism); return this; }

    getValidationTimeoutSeconds(): number { return this._validationTimeoutSeconds; }
    setValidationTimeoutSeconds(timeout: number): this { this._validationTimeoutSeconds = timeout; return this; }

    getDataLoadTimeoutSeconds(): number { return this._dataLoadTimeoutSeconds; }
    setDataLoadTimeoutSeconds(timeout: number): this { this._dataLoadTimeoutSeconds = timeout; return this; }

    getRebalanceDelaySeconds(): number { return this._rebalanceDelaySeconds; }
    setRebalanceDelaySeconds(delay: number): this { this._rebalanceDelaySeconds = delay; return this; }

    isAutoRemoveStaleData(): boolean { return this._autoRemoveStaleData; }
    setAutoRemoveStaleData(auto: boolean): this { this._autoRemoveStaleData = auto; return this; }

    getClusterDataRecoveryPolicy(): ClusterDataRecoveryPolicy { return this._clusterDataRecoveryPolicy; }
    setClusterDataRecoveryPolicy(policy: ClusterDataRecoveryPolicy): this { this._clusterDataRecoveryPolicy = policy; return this; }

    getEncryptionAtRest(): EncryptionAtRestConfig { return this._encryptionAtRest; }
    setEncryptionAtRest(config: EncryptionAtRestConfig): this { this._encryptionAtRest = config; return this; }

    isEncryptionAtRestEnabled(): boolean { return this._encryptionAtRest.enabled && this._encryptionAtRest.key.length > 0; }
}

export type ClusterDataRecoveryPolicy =
    | 'FULL_RECOVERY_ONLY'
    | 'PARTIAL_RECOVERY_MOST_RECENT'
    | 'PARTIAL_RECOVERY_MOST_COMPLETE';
