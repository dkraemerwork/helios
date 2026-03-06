export type ItemEventType = "ADDED" | "REMOVED";

export class ItemEvent<E> {
  constructor(
    private readonly _name: string,
    private readonly _item: E | null,
    private readonly _eventType: ItemEventType,
    private readonly _memberId: string,
  ) {}

  getName(): string {
    return this._name;
  }

  getItem(): E | null {
    return this._item;
  }

  getEventType(): ItemEventType {
    return this._eventType;
  }

  getMemberId(): string {
    return this._memberId;
  }
}
