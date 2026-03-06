/**
 * S3StoreModule — demonstrates @zenystx/s3 as a write-through MapStore.
 *
 * The 'documents' IMap is backed by an S3MapStore. Every put() writes
 * to both the in-memory map and S3 (or MinIO/LocalStack). Every get() for
 * a key not in memory loads the S3 object automatically (read-through).
 *
 * This is a real-world pattern for document metadata storage where fast
 * lookups come from Helios memory, but documents are durably persisted to
 * S3-compatible object storage.
 */

import { Module } from '@nestjs/common';
import { HeliosObjectExtractionModule } from '@zenystx/nestjs';
import { S3StoreService } from './s3-store.service';

@Module({
    imports: [
        HeliosObjectExtractionModule.forRoot({
            namedMaps: ['documents'],
        }),
    ],
    providers: [S3StoreService],
    exports: [S3StoreService],
})
export class S3StoreModule {}
