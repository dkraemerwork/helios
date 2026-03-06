/**
 * TursoStoreModule — demonstrates @zenystx/helios-turso as a write-through MapStore.
 *
 * The 'sessions' IMap is backed by a TursoMapStore. Every put() writes
 * to both the in-memory map and a Turso/libSQL database. Every get() for
 * a key not in memory loads from the SQLite table automatically (read-through).
 *
 * This is a real-world pattern for session management where fast reads come
 * from Helios memory, but sessions survive restarts via Turso persistence.
 * Works with Turso cloud, local libSQL files, or in-memory SQLite.
 */

import { Module } from '@nestjs/common';
import { HeliosObjectExtractionModule } from '@zenystx/helios-nestjs';
import { TursoStoreService } from './turso-store.service';

@Module({
    imports: [
        HeliosObjectExtractionModule.forRoot({
            namedMaps: ['sessions'],
        }),
    ],
    providers: [TursoStoreService],
    exports: [TursoStoreService],
})
export class TursoStoreModule {}
