/**
 * Encrypted Write-Ahead Log wrapper using AES-256-GCM.
 *
 * Wraps WriteAheadLog segment writes with per-entry authenticated encryption.
 * Each encrypted payload uses a random 12-byte IV prepended to the ciphertext + auth tag.
 *
 * Layout per encrypted blob: IV(12) | ciphertext | authTag(16)
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { WALEntry } from './WriteAheadLog.js';
import { WriteAheadLog } from './WriteAheadLog.js';

const AES_ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

/**
 * Encrypt a plaintext Buffer with AES-256-GCM.
 * Returns: IV(12) | ciphertext | authTag(16)
 */
export function encryptAesGcm(key: Buffer, plaintext: Buffer): Buffer {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, ciphertext, authTag]);
}

/**
 * Decrypt a blob produced by encryptAesGcm.
 * Expects: IV(12) | ciphertext | authTag(16)
 */
export function decryptAesGcm(key: Buffer, blob: Buffer): Buffer {
    if (blob.length < IV_LENGTH + AUTH_TAG_LENGTH) {
        throw new Error('EncryptedWAL: blob too short to contain IV and auth tag');
    }
    const iv = blob.subarray(0, IV_LENGTH);
    const authTag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
    const ciphertext = blob.subarray(IV_LENGTH, blob.length - AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * EncryptedWAL wraps a WriteAheadLog and transparently encrypts each entry
 * as it is flushed to disk. Reading back entries decrypts them on the fly.
 *
 * For maximum compatibility, this class operates on an encrypted segment directory
 * that is separate from the plaintext WAL directory. The inner WriteAheadLog
 * writes encrypted bytes to the underlying segment files.
 */
export class EncryptedWAL {
    private readonly _wal: WriteAheadLog;
    private readonly _key: Buffer;

    /**
     * @param wal   The underlying WriteAheadLog (already opened or to be opened).
     * @param encryptionKey  A 32-byte AES-256 key.
     */
    constructor(wal: WriteAheadLog, encryptionKey: Buffer) {
        if (encryptionKey.length !== 32) {
            throw new Error(`EncryptedWAL: encryption key must be 32 bytes for AES-256, got ${encryptionKey.length}`);
        }
        this._wal = wal;
        this._key = encryptionKey;
    }

    /**
     * Encrypt plaintext data for storage in a WAL segment.
     * Returns IV(12) | ciphertext | authTag(16).
     */
    encrypt(data: Buffer): Buffer {
        return encryptAesGcm(this._key, data);
    }

    /**
     * Decrypt a blob previously produced by encrypt().
     */
    decrypt(data: Buffer): Buffer {
        return decryptAesGcm(this._key, data);
    }

    /**
     * Append an encrypted entry by serialising it, encrypting the payload,
     * and delegating to the underlying WAL. The encrypted value replaces the
     * raw value bytes so that the on-disk binary is always encrypted.
     */
    appendEncrypted(entry: Omit<WALEntry, 'sequence' | 'timestamp'>): bigint {
        const encryptedEntry: Omit<WALEntry, 'sequence' | 'timestamp'> = {
            ...entry,
            value: entry.value !== null
                ? new Uint8Array(this.encrypt(Buffer.from(entry.value)))
                : null,
            // Also encrypt the key if present (for maximum confidentiality)
            key: entry.key !== null
                ? new Uint8Array(this.encrypt(Buffer.from(entry.key)))
                : null,
        };
        return this._wal.append(encryptedEntry);
    }

    /**
     * Read all entries from the underlying WAL and decrypt their key/value payloads.
     */
    async readAllDecrypted(): Promise<WALEntry[]> {
        const encrypted = await this._wal.readAll();
        return encrypted.map(entry => ({
            ...entry,
            key: entry.key !== null ? new Uint8Array(this.decrypt(Buffer.from(entry.key))) : null,
            value: entry.value !== null ? new Uint8Array(this.decrypt(Buffer.from(entry.value))) : null,
        }));
    }

    /** Delegate open to the inner WAL. */
    async open(): Promise<void> {
        return this._wal.open();
    }

    /** Delegate close to the inner WAL. */
    close(): void {
        this._wal.close();
    }

    getCurrentSequence(): bigint {
        return this._wal.getCurrentSequence();
    }

    getInnerWAL(): WriteAheadLog {
        return this._wal;
    }

    /**
     * Derive an AES-256 key from a passphrase string using PBKDF2.
     * Use this when the config stores a string key rather than raw bytes.
     */
    static deriveKey(passphrase: string, salt: Buffer = Buffer.from('helios-wal-salt')): Buffer {
        return crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
    }

    /**
     * Re-encrypt all existing WAL segment files in-place.
     * Used when enabling encryption on an existing unencrypted WAL directory.
     */
    static async encryptExistingSegments(walDir: string, key: Buffer): Promise<void> {
        if (!fs.existsSync(walDir)) return;

        const files = (await fs.promises.readdir(walDir))
            .filter(f => f.startsWith('wal-') && f.endsWith('.log'))
            .sort();

        for (const file of files) {
            const filePath = path.join(walDir, file);
            const data = await fs.promises.readFile(filePath);
            const encrypted = encryptAesGcm(key, data);
            await fs.promises.writeFile(filePath + '.enc', encrypted);
            await fs.promises.rename(filePath + '.enc', filePath);
        }
    }
}
