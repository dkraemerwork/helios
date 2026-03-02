/**
 * Barrel export for @helios/nestjs convenience decorators.
 */

export { InjectHelios } from './inject-helios.decorator';
export {
    InjectMap,
    InjectQueue,
    InjectTopic,
    InjectList,
    InjectSet,
    InjectMultiMap,
    InjectReplicatedMap,
    getMapToken,
    getQueueToken,
    getTopicToken,
    getListToken,
    getSetToken,
    getMultiMapToken,
    getReplicatedMapToken,
} from './inject-distributed-object.decorator';
