/**
 * MongoDbStoreService — user profile CRUD backed by MongoDB via MapStore.
 *
 * The 'user-profiles' IMap has a MongoMapStore configured in main.ts.
 * All operations go through the distributed map, which transparently
 * persists to MongoDB:
 *
 *   put(key, value)  → write-through to MongoDB
 *   get(key)         → read-through from MongoDB on cache miss
 *   remove(key)      → delete-through from MongoDB
 *
 * This service demonstrates the real-world pattern of managing user profiles
 * with Helios as the fast in-memory layer and MongoDB as durable storage.
 */

import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { InjectMap } from '@helios/nestjs';
import type { IMap } from '@helios/core/map/IMap';

export interface UserProfile {
    userId: string;
    email: string;
    displayName: string;
    role: 'admin' | 'user' | 'moderator';
    createdAt: string;
    lastLogin: string;
}

@Injectable()
export class MongoDbStoreService {
    constructor(
        @InjectMap('user-profiles') private readonly profiles: IMap<string, UserProfile>,
    ) {}

    /** Create or update a user profile (write-through to MongoDB). */
    async upsertProfile(profile: UserProfile): Promise<void> {
        await this.profiles.put(profile.userId, profile);
    }

    /** Get a profile by userId (read-through from MongoDB on miss). */
    async getProfile(userId: string): Promise<UserProfile | null> {
        return this.profiles.get(userId);
    }

    /** Remove a profile (delete-through from MongoDB). */
    async removeProfile(userId: string): Promise<UserProfile | null> {
        return this.profiles.remove(userId);
    }

    /** Seed sample user profiles into the map. */
    async seed(): Promise<void> {
        const now = new Date().toISOString();
        const users: UserProfile[] = [
            { userId: 'u1', email: 'alice@example.com', displayName: 'Alice Chen', role: 'admin', createdAt: now, lastLogin: now },
            { userId: 'u2', email: 'bob@example.com', displayName: 'Bob Smith', role: 'user', createdAt: now, lastLogin: now },
            { userId: 'u3', email: 'carol@example.com', displayName: 'Carol Wu', role: 'moderator', createdAt: now, lastLogin: now },
        ];
        for (const u of users) {
            await this.upsertProfile(u);
        }
    }

    /** Run the MongoDB MapStore demo showing write-through and read-through. */
    async runDemo(): Promise<void> {
        console.log('  Seeding 3 user profiles (write-through to MongoDB)...');
        await this.seed();
        console.log(`  Map size after seeding: ${this.profiles.size()}`);

        // Read-through: first get may load from MongoDB if not in memory
        const alice = await this.getProfile('u1');
        console.log(`\n  get('u1') → ${alice?.displayName} (${alice?.email}) [role: ${alice?.role}]`);

        const bob = await this.getProfile('u2');
        console.log(`  get('u2') → ${bob?.displayName} (${bob?.email}) [role: ${bob?.role}]`);

        // Update a profile (write-through)
        if (alice) {
            const updated: UserProfile = { ...alice, role: 'moderator', lastLogin: new Date().toISOString() };
            await this.upsertProfile(updated);
            const reloaded = await this.getProfile('u1');
            console.log(`\n  Updated Alice's role to '${reloaded?.role}' (write-through to MongoDB)`);
        }

        // Remove a profile (delete-through)
        const removed = await this.removeProfile('u3');
        console.log(`\n  Removed '${removed?.displayName}' (delete-through from MongoDB)`);
        console.log(`  Map size after removal: ${this.profiles.size()}`);

        // Verify removal
        const ghost = await this.getProfile('u3');
        console.log(`  get('u3') after removal → ${ghost ?? 'null'} (confirmed deleted)`);
    }
}
