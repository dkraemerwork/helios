import type { Message } from './Message';

/** Callback type for topic message listeners. */
export type MessageListener<T> = (message: Message<T>) => void;
