import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HeliosEventBridge } from './helios-event-bridge';

/**
 * NestJS module that provides `HeliosEventBridge`.
 *
 * Import this module (alongside `HeliosModule.forRoot(...)`) to enable
 * bridging of Helios map/topic/lifecycle events to `@nestjs/event-emitter`.
 *
 * ```typescript
 * @Module({
 *   imports: [
 *     HeliosModule.forRoot(instance),
 *     HeliosEventBridgeModule,
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({
    imports: [EventEmitterModule.forRoot()],
    providers: [HeliosEventBridge],
    exports: [HeliosEventBridge],
})
export class HeliosEventBridgeModule {}
