import type { EncodedData } from '@zenystx/helios-core/cluster/tcp/DataWireCodec';

export type TransactionBackupRecord =
    | {
        readonly kind: 'map';
        readonly mapName: string;
        readonly partitionId: number;
        readonly entry: {
            readonly opType: 'put' | 'set' | 'remove' | 'delete' | 'putIfAbsent' | 'replace';
            readonly key: EncodedData;
            readonly value: EncodedData | null;
            readonly oldValue: EncodedData | null;
        };
    }
    | {
        readonly kind: 'queue';
        readonly queueName: string;
        readonly opType: 'offer' | 'poll';
        readonly valueData: EncodedData | null;
    }
    | {
        readonly kind: 'list';
        readonly listName: string;
        readonly opType: 'add' | 'remove';
        readonly valueData: EncodedData;
    }
    | {
        readonly kind: 'set';
        readonly setName: string;
        readonly opType: 'add' | 'remove';
        readonly valueData: EncodedData;
    }
    | {
        readonly kind: 'multimap';
        readonly mapName: string;
        readonly opType: 'put' | 'remove' | 'removeAll';
        readonly keyData: EncodedData;
        readonly valueData: EncodedData | null;
    };
