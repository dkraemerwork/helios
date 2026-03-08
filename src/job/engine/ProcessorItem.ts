export type ProcessorItem =
  | { type: 'data'; value: unknown; key?: string; timestamp: number }
  | { type: 'barrier'; snapshotId: string }
  | { type: 'eos' }
  | { type: 'watermark'; timestamp: number };
