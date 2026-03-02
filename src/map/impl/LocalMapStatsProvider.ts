/**
 * Port of {@code com.hazelcast.map.impl.LocalMapStatsProvider} (minimal surface).
 */
import type { LocalMapStatsImpl } from '@helios/internal/monitor/impl/LocalMapStatsImpl';

export interface LocalMapStatsProvider {
    hasLocalMapStatsImpl(mapName: string): boolean;
    getLocalMapStatsImpl(mapName: string): LocalMapStatsImpl;
}
