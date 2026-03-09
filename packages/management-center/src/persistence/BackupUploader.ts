/**
 * S3-compatible upload service for database backup snapshots.
 *
 * Supports static IAM credentials, STS role assumption, and a configurable
 * encryption key for encrypting backup data before upload. Retries transient
 * S3 failures with exponential backoff.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/ConfigService.js';
import * as crypto from 'crypto';
import * as fs from 'fs';

const MAX_UPLOAD_RETRIES = 3;
const UPLOAD_RETRY_BASE_MS = 2000;

/** AES-256-GCM encryption parameters. */
const CIPHER_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

@Injectable()
export class BackupUploader {
  private readonly logger = new Logger(BackupUploader.name);
  private readonly bucketUrl: string | undefined;
  private readonly region: string | undefined;
  private readonly accessKeyId: string | undefined;
  private readonly secretAccessKey: string | undefined;
  private readonly roleArn: string | undefined;
  private readonly encryptionKey: string;

  constructor(private readonly configService: ConfigService) {
    this.bucketUrl = configService.backupBucketUrl;
    this.region = configService.backupBucketRegion;
    this.accessKeyId = configService.backupAccessKeyId;
    this.secretAccessKey = configService.backupSecretAccessKey;
    this.roleArn = configService.backupRoleArn;
    this.encryptionKey = configService.backupEncryptionKey;
  }

  /** Returns true if backup uploads are configured. */
  isConfigured(): boolean {
    return !!this.bucketUrl;
  }

  /**
   * Encrypts and uploads a file to the configured S3-compatible bucket.
   * Returns the S3 key of the uploaded object on success.
   */
  async upload(filePath: string, objectKey: string): Promise<string> {
    if (!this.bucketUrl) {
      throw new Error('Backup upload not configured: no bucket URL');
    }

    const data = fs.readFileSync(filePath);
    const encrypted = this.encrypt(data);

    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
      try {
        const s3Client = await this.createS3Client();
        const { PutObjectCommand } = await import('@aws-sdk/client-s3');

        await s3Client.send(
          new PutObjectCommand({
            Bucket: this.extractBucketName(),
            Key: objectKey,
            Body: encrypted,
            ContentType: 'application/octet-stream',
            Metadata: {
              'x-helios-encrypted': this.encryptionKey ? 'aes-256-gcm' : 'none',
            },
          }),
        );

        this.logger.log(`Backup uploaded successfully: ${objectKey}`);
        return objectKey;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_UPLOAD_RETRIES) {
          const backoff = UPLOAD_RETRY_BASE_MS * Math.pow(2, attempt);
          this.logger.warn(
            `Upload attempt ${attempt + 1} failed, retrying in ${backoff}ms: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    throw new Error(
      `Backup upload failed after ${MAX_UPLOAD_RETRIES + 1} attempts: ` +
        `${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  /** Encrypts data with AES-256-GCM if an encryption key is configured. */
  private encrypt(data: Buffer): Buffer {
    if (!this.encryptionKey) {
      return data;
    }

    const key = crypto.scryptSync(this.encryptionKey, 'helios-backup-salt', 32);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: [IV (16 bytes)][Auth Tag (16 bytes)][Encrypted Data]
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /** Creates an S3Client with either static credentials or STS role assumption. */
  private async createS3Client(): Promise<import('@aws-sdk/client-s3').S3Client> {
    const s3Module = await import('@aws-sdk/client-s3');

    const endpoint = this.extractEndpoint();
    const clientConfig: ConstructorParameters<typeof s3Module.S3Client>[0] = {
      region: this.region ?? 'us-east-1',
    };

    if (endpoint) {
      clientConfig.endpoint = endpoint;
      clientConfig.forcePathStyle = true;
    }

    if (this.roleArn) {
      const { STSClient, AssumeRoleCommand } = await import('@aws-sdk/client-sts');
      const stsClient = new STSClient({ region: this.region ?? 'us-east-1' });
      const assumed = await stsClient.send(
        new AssumeRoleCommand({
          RoleArn: this.roleArn,
          RoleSessionName: 'helios-backup',
          DurationSeconds: 3600,
        }),
      );

      if (assumed.Credentials) {
        clientConfig.credentials = {
          accessKeyId: assumed.Credentials.AccessKeyId!,
          secretAccessKey: assumed.Credentials.SecretAccessKey!,
          sessionToken: assumed.Credentials.SessionToken,
        };
      }
    } else if (this.accessKeyId && this.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      };
    }

    return new s3Module.S3Client(clientConfig);
  }

  /** Extracts the bucket name from the configured URL. */
  private extractBucketName(): string {
    if (!this.bucketUrl) return '';
    try {
      const url = new URL(this.bucketUrl);
      // s3://bucket-name/prefix or https://bucket.s3.region.amazonaws.com
      if (url.protocol === 's3:') {
        return url.hostname;
      }
      // Extract from hostname: bucket.s3.amazonaws.com
      const parts = url.hostname.split('.');
      if (parts.length > 2 && parts[1] === 's3') {
        return parts[0]!;
      }
      // Path-style: s3.amazonaws.com/bucket
      return url.pathname.split('/')[1] ?? '';
    } catch {
      return this.bucketUrl;
    }
  }

  /** Extracts an S3-compatible endpoint if the URL isn't standard AWS. */
  private extractEndpoint(): string | undefined {
    if (!this.bucketUrl) return undefined;
    try {
      const url = new URL(this.bucketUrl);
      if (url.protocol === 's3:') return undefined;
      // For non-standard endpoints (e.g., MinIO), return the origin
      if (!url.hostname.endsWith('.amazonaws.com')) {
        return url.origin;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
