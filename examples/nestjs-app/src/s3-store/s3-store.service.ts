/**
 * S3StoreService — document metadata CRUD backed by S3 via MapStore.
 *
 * The 'documents' IMap has an S3MapStore configured in main.ts.
 * All operations go through the distributed map, which transparently
 * persists document metadata as JSON objects in an S3 bucket:
 *
 *   put(key, value)  → write-through to S3 as s3://bucket/documents/key.json
 *   get(key)         → read-through from S3 on cache miss
 *   remove(key)      → delete-through from S3
 *
 * Real-world scenario: a document management system where metadata (title,
 * author, tags, size) is stored in S3 and cached in Helios for fast lookups.
 * Works with AWS S3, MinIO, or LocalStack.
 */

import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { InjectMap } from '@zenystx/helios-nestjs';
import type { IMap } from '@zenystx/helios-core/map/IMap';

export interface DocumentMeta {
    docId: string;
    title: string;
    author: string;
    mimeType: string;
    sizeBytes: number;
    tags: string[];
    uploadedAt: string;
    version: number;
}

@Injectable()
export class S3StoreService {
    constructor(
        @InjectMap('documents') private readonly documents: IMap<string, DocumentMeta>,
    ) {}

    /** Upload document metadata (write-through to S3). */
    async uploadDocument(doc: DocumentMeta): Promise<void> {
        await this.documents.put(doc.docId, doc);
    }

    /** Retrieve document metadata (read-through from S3 on miss). */
    async getDocument(docId: string): Promise<DocumentMeta | null> {
        return this.documents.get(docId);
    }

    /** Remove document metadata (delete-through from S3). */
    async removeDocument(docId: string): Promise<DocumentMeta | null> {
        return this.documents.remove(docId);
    }

    /** Seed sample documents into the map. */
    async seed(): Promise<void> {
        const now = new Date().toISOString();
        const docs: DocumentMeta[] = [
            {
                docId: 'doc-001',
                title: 'Q4 Financial Report',
                author: 'Finance Team',
                mimeType: 'application/pdf',
                sizeBytes: 2_458_624,
                tags: ['finance', 'quarterly', 'report'],
                uploadedAt: now,
                version: 1,
            },
            {
                docId: 'doc-002',
                title: 'Architecture Decision Record - Event Sourcing',
                author: 'Engineering',
                mimeType: 'text/markdown',
                sizeBytes: 15_872,
                tags: ['architecture', 'adr', 'engineering'],
                uploadedAt: now,
                version: 3,
            },
            {
                docId: 'doc-003',
                title: 'Employee Onboarding Handbook',
                author: 'HR Department',
                mimeType: 'application/pdf',
                sizeBytes: 5_242_880,
                tags: ['hr', 'onboarding', 'handbook'],
                uploadedAt: now,
                version: 7,
            },
        ];
        for (const doc of docs) {
            await this.uploadDocument(doc);
        }
    }

    /** Format byte size as human-readable string. */
    private formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /** Run the S3 MapStore demo showing write-through and read-through. */
    async runDemo(): Promise<void> {
        console.log('  Uploading 3 documents (write-through to S3)...');
        await this.seed();
        console.log(`  Map size after upload: ${this.documents.size()}`);

        // Read-through: retrieve documents from S3-backed map
        const report = await this.getDocument('doc-001');
        console.log(`\n  get('doc-001') → "${report?.title}"`);
        console.log(`    Author: ${report?.author} | Size: ${this.formatSize(report?.sizeBytes ?? 0)} | v${report?.version}`);
        console.log(`    Tags: [${report?.tags.join(', ')}]`);

        const adr = await this.getDocument('doc-002');
        console.log(`\n  get('doc-002') → "${adr?.title}"`);
        console.log(`    Author: ${adr?.author} | Size: ${this.formatSize(adr?.sizeBytes ?? 0)} | v${adr?.version}`);
        console.log(`    Tags: [${adr?.tags.join(', ')}]`);

        // Update document version (write-through)
        if (adr) {
            const updated: DocumentMeta = { ...adr, version: adr.version + 1, sizeBytes: 16_384 };
            await this.uploadDocument(updated);
            const reloaded = await this.getDocument('doc-002');
            console.log(`\n  Updated ADR to v${reloaded?.version} (write-through to S3)`);
        }

        // Remove a document (delete-through)
        const removed = await this.removeDocument('doc-003');
        console.log(`\n  Removed "${removed?.title}" (delete-through from S3)`);
        console.log(`  Map size after removal: ${this.documents.size()}`);

        // Verify removal
        const ghost = await this.getDocument('doc-003');
        console.log(`  get('doc-003') after removal → ${ghost ?? 'null'} (confirmed deleted)`);
    }
}
