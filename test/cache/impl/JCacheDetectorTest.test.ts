/**
 * Port of {@code com.hazelcast.cache.impl.JCacheDetectorTest}.
 */
import { JCacheDetector } from '@zenystx/helios-core/cache/impl/JCacheDetector';
import { describe, expect, test } from 'bun:test';

describe('JCacheDetectorTest', () => {
    test('testIsJCacheAvailable_withCorrectVersion', () => {
        const checker = (_className: string) => true;
        expect(JCacheDetector.isJCacheAvailable(checker)).toBe(true);
    });

    test('testIsJCacheAvailable_withCorrectVersion_withLogger', () => {
        const checker = (_className: string) => true;
        const logger = { warning: () => {} };
        expect(JCacheDetector.isJCacheAvailable(checker, logger)).toBe(true);
    });

    test('testIsJCacheAvailable_notFound', () => {
        const checker = (_className: string) => false;
        expect(JCacheDetector.isJCacheAvailable(checker)).toBe(false);
    });

    test('testIsJCacheAvailable_notFound_withLogger', () => {
        const checker = (_className: string) => false;
        const logger = { warning: () => {} };
        expect(JCacheDetector.isJCacheAvailable(checker, logger)).toBe(false);
    });

    test('testIsJCacheAvailable_withWrongJCacheVersion_missingCaching', () => {
        // Only javax.cache.Caching is found but not additional required classes
        const checker = (className: string) => className === 'javax.cache.Caching';
        expect(JCacheDetector.isJCacheAvailable(checker)).toBe(false);
    });

    test('testIsJCacheAvailable_withWrongJCacheVersion_withLogger', () => {
        let warningLogged = false;
        const logger = { warning: (_msg: string) => { warningLogged = true; } };
        const checker = (className: string) => className === 'javax.cache.Caching';
        expect(JCacheDetector.isJCacheAvailable(checker, logger)).toBe(false);
        expect(warningLogged).toBe(true);
    });

    test('testIsJCacheAvailable_missingOneAdditionalClass', () => {
        const additionalRequired = [
            'javax.cache.integration.CacheLoaderException',
            'javax.cache.integration.CacheWriterException',
            'javax.cache.processor.EntryProcessorException',
            'javax.cache.configuration.CompleteConfiguration',
        ];
        // Caching present, but one additional class is missing
        const checker = (className: string) => {
            if (className === 'javax.cache.Caching') return true;
            return additionalRequired.filter((_, i) => i > 0).includes(className);
        };
        expect(JCacheDetector.isJCacheAvailable(checker)).toBe(false);
    });
});
