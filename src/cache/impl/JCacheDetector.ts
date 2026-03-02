/**
 * Port of {@code com.hazelcast.cache.impl.JCacheDetector}.
 * Detects whether a complete JCache 1.0.0 API is available on the classpath.
 * In the TypeScript/Bun port this is used to guard against stale JCache versions.
 */

const JCACHE_CACHING_CLASSNAME = 'javax.cache.Caching';
const JCACHE_ADDITIONAL_REQUIRED_CLASSES: readonly string[] = [
    'javax.cache.integration.CacheLoaderException',
    'javax.cache.integration.CacheWriterException',
    'javax.cache.processor.EntryProcessorException',
    'javax.cache.configuration.CompleteConfiguration',
];

/** @FunctionalInterface — checks whether a class name is available. */
export type ClassAvailabilityChecker = (className: string) => boolean;

interface Logger {
    warning(msg: string): void;
}

export class JCacheDetector {
    private constructor() {}

    /**
     * Returns {@code true} if a complete JCache 1.0.0 API is detected via {@code checker}.
     * Optionally logs a warning via {@code logger} when an outdated version is detected.
     */
    static isJCacheAvailable(checker: ClassAvailabilityChecker, logger?: Logger): boolean {
        if (!checker(JCACHE_CACHING_CLASSNAME)) {
            return false;
        }
        for (const className of JCACHE_ADDITIONAL_REQUIRED_CLASSES) {
            if (!checker(className)) {
                if (logger) {
                    logger.warning(
                        'An outdated version of JCache API was located in the classpath, please use newer versions of ' +
                        'JCache API rather than 1.0.0-PFD or 0.x versions.',
                    );
                }
                return false;
            }
        }
        return true;
    }
}
