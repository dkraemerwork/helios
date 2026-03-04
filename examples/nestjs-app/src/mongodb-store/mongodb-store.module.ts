/**
 * MongoDbStoreModule — demonstrates @helios/mongodb as a write-through MapStore.
 *
 * The 'user-profiles' IMap is backed by a MongoMapStore. Every put() writes
 * to both the in-memory map and MongoDB. Every get() for a key not in memory
 * loads from MongoDB automatically (read-through).
 *
 * This is a real-world pattern for user profiles where fast reads come from
 * Helios memory, but data survives process restarts via MongoDB persistence.
 */

import { Module } from '@nestjs/common';
import { HeliosObjectExtractionModule } from '@helios/nestjs';
import { MongoDbStoreService } from './mongodb-store.service';

@Module({
    imports: [
        HeliosObjectExtractionModule.forRoot({
            namedMaps: ['user-profiles'],
        }),
    ],
    providers: [MongoDbStoreService],
    exports: [MongoDbStoreService],
})
export class MongoDbStoreModule {}
