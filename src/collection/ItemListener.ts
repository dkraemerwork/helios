import type { ItemEvent } from "@helios/collection/ItemEvent";

export interface ItemListener<E> {
  itemAdded?(event: ItemEvent<E>): void;
  itemRemoved?(event: ItemEvent<E>): void;
}
