/**
 * NestJS auto-configuration module for Helios.
 *
 * Equivalent of Spring Boot's {@code @AutoConfiguration} + Hazelcast Spring Boot 4
 * auto-configuration. In NestJS there is no classpath scanning, so callers
 * explicitly call {@link HeliosAutoConfigurationModule.forRoot} or
 * {@link HeliosAutoConfigurationModule.forRootAsync} to bootstrap the instance.
 *
 * The module is global ({@code @Global()}) so that a single import makes the
 * {@link HELIOS_INSTANCE_TOKEN} available throughout the entire application.
 *
 * @since 5.7 (Helios port)
 */

import { DynamicModule, Global, Module } from '@nestjs/common';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';
import { HELIOS_INSTANCE_TOKEN } from '../HeliosInstanceDefinition';

export interface HeliosAutoConfigurationAsyncOptions {
    useFactory: (...args: unknown[]) => HeliosInstance | Promise<HeliosInstance>;
    inject?: unknown[];
}

@Global()
@Module({})
export class HeliosAutoConfigurationModule {
    /**
     * Synchronous registration — provide an already-constructed {@link HeliosInstance}.
     *
     * Mirrors the Spring Boot pattern where a {@code @Bean HazelcastInstance} is
     * declared in a {@code @SpringBootApplication} config class.
     */
    static forRoot(instance: HeliosInstance): DynamicModule {
        return {
            module: HeliosAutoConfigurationModule,
            global: true,
            providers: [
                {
                    provide: HELIOS_INSTANCE_TOKEN,
                    useValue: instance,
                },
            ],
            exports: [HELIOS_INSTANCE_TOKEN],
        };
    }

    /**
     * Asynchronous registration — delegate instance creation to a factory function.
     *
     * Equivalent of Spring Boot auto-reading {@code helios.config} from environment
     * and lazily constructing the instance on first demand.
     */
    static forRootAsync(options: HeliosAutoConfigurationAsyncOptions): DynamicModule {
        return {
            module: HeliosAutoConfigurationModule,
            global: true,
            providers: [
                {
                    provide: HELIOS_INSTANCE_TOKEN,
                    useFactory: options.useFactory,
                    inject: (options.inject ?? []) as string[],
                },
            ],
            exports: [HELIOS_INSTANCE_TOKEN],
        };
    }
}
