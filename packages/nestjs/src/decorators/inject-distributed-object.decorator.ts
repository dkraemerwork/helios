/**
 * Convenience parameter decorators for injecting named Helios distributed objects.
 *
 * Each decorator uses a well-known token produced by the corresponding `get*Token()`
 * helper. The same helpers are used by {@link HeliosObjectExtractionModule} when
 * registering providers, so the decorator token and the provider token always agree.
 *
 * ```typescript
 * @Injectable()
 * class UserService {
 *     constructor(
 *         @InjectMap('users')  private readonly users: IMap<string, User>,
 *         @InjectQueue('jobs') private readonly jobs:  IQueue<Job>,
 *     ) {}
 * }
 * ```
 */

import { Inject } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/** Injection token for a named IMap. */
export const getMapToken = (name: string): string => `HELIOS_MAP_${name}`;

/** Injection token for a named IQueue. */
export const getQueueToken = (name: string): string => `HELIOS_QUEUE_${name}`;

/** Injection token for a named ITopic. */
export const getTopicToken = (name: string): string => `HELIOS_TOPIC_${name}`;

/** Injection token for a named IList. */
export const getListToken = (name: string): string => `HELIOS_LIST_${name}`;

/** Injection token for a named ISet. */
export const getSetToken = (name: string): string => `HELIOS_SET_${name}`;

/** Injection token for a named MultiMap. */
export const getMultiMapToken = (name: string): string => `HELIOS_MULTIMAP_${name}`;

/** Injection token for a named ReplicatedMap. */
export const getReplicatedMapToken = (name: string): string => `HELIOS_REPLICATED_MAP_${name}`;

// ---------------------------------------------------------------------------
// Parameter decorators
// ---------------------------------------------------------------------------

/** Injects the named IMap. */
export const InjectMap = (name: string): ParameterDecorator => Inject(getMapToken(name));

/** Injects the named IQueue. */
export const InjectQueue = (name: string): ParameterDecorator => Inject(getQueueToken(name));

/** Injects the named ITopic. */
export const InjectTopic = (name: string): ParameterDecorator => Inject(getTopicToken(name));

/** Injects the named IList. */
export const InjectList = (name: string): ParameterDecorator => Inject(getListToken(name));

/** Injects the named ISet. */
export const InjectSet = (name: string): ParameterDecorator => Inject(getSetToken(name));

/** Injects the named MultiMap. */
export const InjectMultiMap = (name: string): ParameterDecorator => Inject(getMultiMapToken(name));

/** Injects the named ReplicatedMap. */
export const InjectReplicatedMap = (name: string): ParameterDecorator =>
    Inject(getReplicatedMapToken(name));
