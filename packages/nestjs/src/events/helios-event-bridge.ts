import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { HeliosInstance } from '@zenystx/helios-core/core/HeliosInstance';
import type { LifecycleEvent } from '@zenystx/helios-core/instance/lifecycle/LifecycleEvent';
import type { EntryEvent } from '@zenystx/helios-core/map/EntryListener';
import type { Message } from '@zenystx/helios-core/topic/Message';
import { InjectHelios } from '../decorators/inject-helios.decorator';

/**
 * Bridges Helios entry listeners, topic messages, and lifecycle events to
 * `@nestjs/event-emitter` so NestJS consumers can use `@OnEvent()` decorators.
 *
 * Event naming convention:
 *   - Map entry events:  `helios.map.<name>.added|updated|removed|evicted`
 *   - Topic messages:    `helios.topic.<name>`
 *   - Lifecycle events:  `helios.lifecycle.<STATE>`
 */
@Injectable()
export class HeliosEventBridge {
    constructor(
        @InjectHelios() private readonly helios: HeliosInstance,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    /**
     * Registers an entry listener on the named map and forwards each event
     * to the EventEmitter2 bus under `helios.map.<mapName>.*`.
     */
    bridgeMap(mapName: string): void {
        const map = this.helios.getMap(mapName);
        map.addEntryListener({
            entryAdded:   (e: EntryEvent<unknown, unknown>) => this.eventEmitter.emit(`helios.map.${mapName}.added`, e),
            entryUpdated: (e: EntryEvent<unknown, unknown>) => this.eventEmitter.emit(`helios.map.${mapName}.updated`, e),
            entryRemoved: (e: EntryEvent<unknown, unknown>) => this.eventEmitter.emit(`helios.map.${mapName}.removed`, e),
            entryEvicted: (e: EntryEvent<unknown, unknown>) => this.eventEmitter.emit(`helios.map.${mapName}.evicted`, e),
        });
    }

    /**
     * Registers a message listener on the named topic and forwards each
     * message to the EventEmitter2 bus under `helios.topic.<topicName>`.
     */
    bridgeTopic(topicName: string): void {
        const topic = this.helios.getTopic(topicName);
        topic.addMessageListener((msg: Message<unknown>) =>
            this.eventEmitter.emit(`helios.topic.${topicName}`, msg),
        );
    }

    /**
     * Registers a lifecycle listener on the HeliosInstance and forwards
     * each state-change event to `helios.lifecycle.<STATE>`.
     */
    bridgeLifecycle(): void {
        this.helios.getLifecycleService().addLifecycleListener({
            stateChanged: (event: LifecycleEvent) =>
                this.eventEmitter.emit(`helios.lifecycle.${event.getState()}`, event),
        });
    }
}
