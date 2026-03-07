/**
 * MongoDB MapStore — Programmatic wiring example for native Helios apps.
 *
 * Demonstrates:
 * - Programmatic MapStore wiring via setImplementation()
 * - Write-through (default) and write-behind persistence
 * - Restart durability: data survives process restart via MongoDB
 * - Bulk operations: putAll() routes to storeAll()
 * - EAGER/LAZY initial load modes
 *
 * Prerequisites:
 *   - MongoDB running at mongodb://127.0.0.1:27017
 *   - Install: bun add @zenystx/helios-mongodb
 *
 * Run:
 *   HELIOS_MONGODB_TEST_URI=mongodb://127.0.0.1:27017 bun run src/mongodb-mapstore-example.ts
 */

// import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
// import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
// import { MapStoreConfig, InitialLoadMode } from '@zenystx/helios-core/config/MapStoreConfig';
// import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
// import { MongoMapStore } from '@zenystx/helios-mongodb';

// ── Configuration ───────────────────────────────────────────────────────────

const MONGO_URI = process.env.HELIOS_MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017';
const MONGO_DB = 'helios_example';

// ── Programmatic wiring ─────────────────────────────────────────────────────

// To use with a real MongoDB instance, uncomment MongoMapStore import above and:
//
// const mongoStore = new MongoMapStore({
//   uri: MONGO_URI,
//   database: MONGO_DB,
//   collection: 'products',
// });
//
// const storeConfig = new MapStoreConfig()
//   .setEnabled(true)
//   .setImplementation(mongoStore);
//
// For write-behind (async batched persistence):
//
// const writeBehindConfig = new MapStoreConfig()
//   .setEnabled(true)
//   .setImplementation(mongoStore)
//   .setWriteDelaySeconds(5)    // flush every 5 seconds
//   .setWriteBatchSize(50);     // batch up to 50 entries per storeAll call
//
// For EAGER preload (load all keys on startup):
//
// const eagerConfig = new MapStoreConfig()
//   .setEnabled(true)
//   .setImplementation(mongoStore)
//   .setInitialLoadMode(InitialLoadMode.EAGER);

console.log('MongoDB MapStore example configuration:');
console.log(`  URI: ${MONGO_URI}`);
console.log(`  Database: ${MONGO_DB}`);
console.log('');
console.log('Supported wiring paths:');
console.log('  1. Programmatic: config.setImplementation(mongoStore)');
console.log('  2. Factory: config.setFactoryImplementation(factory)');
console.log('  3. Registry: HeliosConfig.registerMapStoreProvider(name, provider)');
console.log('  4. Dynamic loading: config.setClassName("@zenystx/helios-mongodb#MongoMapStore")');
console.log('  5. JSON/YAML config with className or factoryClassName');
