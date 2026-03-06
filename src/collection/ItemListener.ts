import type { ItemEvent } from "@zenystx/helios-core/collection/ItemEvent";

export interface ItemListener<E> {
  itemAdded?(event: ItemEvent<E>): void;
  itemRemoved?(event: ItemEvent<E>): void;
}
