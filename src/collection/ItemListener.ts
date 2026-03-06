import type { ItemEvent } from "@zenystx/core/collection/ItemEvent";

export interface ItemListener<E> {
  itemAdded?(event: ItemEvent<E>): void;
  itemRemoved?(event: ItemEvent<E>): void;
}
