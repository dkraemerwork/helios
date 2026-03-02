/**
 * Class decorator that marks an object as NestAware — meaning NestJS dependencies
 * will be injected into it by {@link NestManagedContext} when it is initialized.
 *
 * Port of {@code com.hazelcast.spring.context.SpringAware}.
 *
 * Usage:
 *   @NestAware()
 *   class MyTask implements Runnable {
 *     @Inject(SOME_SERVICE) service!: SomeService;
 *     run() { this.service.doWork(); }
 *   }
 */

export const NEST_AWARE_METADATA_KEY = Symbol('NestAware');

export function NestAware(): ClassDecorator {
    return (target: object) => {
        Reflect.defineMetadata(NEST_AWARE_METADATA_KEY, true, target);
    };
}

/** Returns true if the class (or instance's prototype chain) has @NestAware metadata. */
export function isNestAware(obj: object): boolean {
    return Reflect.getMetadata(NEST_AWARE_METADATA_KEY, obj.constructor) === true;
}
