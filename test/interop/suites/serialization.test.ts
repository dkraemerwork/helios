import { Client, Fields, GenericRecords } from 'hazelcast-client';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HazelcastSerializationConfig } from '@zenystx/helios-core/internal/serialization/HazelcastSerializationService';
import { ClassDefinitionBuilder } from '@zenystx/helios-core/internal/serialization/portable/PortableSerializer';
import { HeliosTestCluster } from '../helpers/HeliosTestCluster';

const IDS_FACTORY_ID = 91;
const IDS_CLASS_ID = 7;
const PORTABLE_FACTORY_ID = 72;
const PORTABLE_CLASS_ID = 5;
const CUSTOM_SERIALIZER_ID = 777;
const GLOBAL_SERIALIZER_ID = 778;

class MemberIds {
  constructor(public id = 0, public name = '') {}

  getFactoryId(): number { return IDS_FACTORY_ID; }
  getClassId(): number { return IDS_CLASS_ID; }
  writeData(out: any): void {
    out.writeInt(this.id);
    out.writeString(this.name);
  }
  readData(inp: any): void {
    this.id = inp.readInt();
    this.name = inp.readString() ?? '';
  }
}

class ClientIds {
  factoryId = IDS_FACTORY_ID;
  classId = IDS_CLASS_ID;

  constructor(public id = 0, public name = '') {}

  writeData(out: any): void {
    out.writeInt(this.id);
    out.writeString(this.name);
  }
  readData(inp: any): void {
    this.id = inp.readInt();
    this.name = inp.readString() ?? '';
  }
}

class MemberPortable {
  constructor(public id = 0, public name: string | null = null) {}

  getFactoryId(): number { return PORTABLE_FACTORY_ID; }
  getClassId(): number { return PORTABLE_CLASS_ID; }
  writePortable(writer: any): void {
    writer.writeInt('id', this.id);
    writer.writeString('name', this.name);
  }
  readPortable(reader: any): void {
    this.id = reader.readInt('id');
    this.name = reader.readString('name');
  }
}

class ClientPortable {
  factoryId = PORTABLE_FACTORY_ID;
  classId = PORTABLE_CLASS_ID;

  constructor(public id = 0, public name: string | null = null) {}

  writePortable(writer: any): void {
    writer.writeInt('id', this.id);
    writer.writeString('name', this.name);
  }
  readPortable(reader: any): void {
    this.id = reader.readInt('id');
    this.name = reader.readString('name');
  }
}

class MemberCompact {
  constructor(public id: number, public name: string | null, public maybeAge: number | null) {}
}

class ClientCompact {
  constructor(public id: number, public name: string | null, public maybeAge: number | null) {}
}

class CustomPayload {
  readonly hzCustomId = CUSTOM_SERIALIZER_ID;

  constructor(public label: string) {}
}

enum DeliveryState {
  READY = 'READY',
  WAITING = 'WAITING',
}

describe('Official Client - serialization parity', () => {
  let cluster: HeliosTestCluster;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>>;

  beforeEach(async () => {
    cluster = new HeliosTestCluster({
      configureMember: (config) => {
        const configWithSerialization = config as typeof config & {
          _serializationConfig?: HazelcastSerializationConfig;
          getSerializationConfig?: () => HazelcastSerializationConfig;
        };
        const serialization: any = configWithSerialization._serializationConfig ?? new HazelcastSerializationConfig();
        configWithSerialization._serializationConfig = serialization;
        configWithSerialization.getSerializationConfig = () => serialization;
        serialization.dataSerializableFactories.set(IDS_FACTORY_ID, { create: () => new MemberIds() });
        serialization.portableFactories.set(PORTABLE_FACTORY_ID, { create: () => new MemberPortable() });
        serialization.classDefinitions.push(
          new ClassDefinitionBuilder(PORTABLE_FACTORY_ID, PORTABLE_CLASS_ID)
            .addIntField('id')
            .addStringField('name')
            .build(),
        );
        serialization.compactSerializers.push({
          getClass: () => MemberCompact as unknown as new (...args: unknown[]) => unknown,
          getTypeName: () => 'interop-compact',
          write: (writer: any, object: MemberCompact) => {
            writer.writeInt32('id', object.id);
            writer.writeString('name', object.name);
            writer.writeNullableInt32('maybeAge', object.maybeAge);
          },
          read: (reader: any) => new MemberCompact(reader.readInt32('id'), reader.readString('name'), reader.readNullableInt32('maybeAge')),
        });
        serialization.customSerializers.push({
          id: CUSTOM_SERIALIZER_ID,
          clazz: CustomPayload,
          read: (inp: any) => new CustomPayload(inp.readString() ?? ''),
          write: (out: any, obj: CustomPayload) => out.writeString(obj.label),
        });
        serialization.globalSerializer = {
          id: GLOBAL_SERIALIZER_ID,
          read: (inp: any) => JSON.parse(inp.readString() ?? 'null'),
          write: (out: any, obj: unknown) => out.writeString(JSON.stringify(obj, (_key, value) => typeof value === 'bigint' ? value.toString() : value)),
        };
      },
    });

    const { clusterName, addresses } = await cluster.startSingle();
    hzClient = await Client.newHazelcastClient(clientConfig(clusterName, addresses));
  });

  afterEach(async () => {
    try { await hzClient.shutdown(); } catch { /* ignore */ }
    await cluster.shutdown();
  });

  it('proves primitives and arrays move between official client and member runtime', async () => {
    const map = await hzClient.getMap<string, unknown>('interop-serialization-primitives');
    await map.put('client-array', [1, 2, 3]);
    await map.put('client-string', 'hello');

    const memberMap = cluster.getRunningInstances()[0]!.getMap<string, unknown>('interop-serialization-primitives');
    expect(await memberMap.get('client-array')).toEqual([1, 2, 3]);
    expect(await memberMap.get('client-string')).toBe('hello');

    await memberMap.put('member-array', ['a', 'b']);
    await memberMap.put('member-number', 9);
    expect(await map.get('member-array')).toEqual(['a', 'b']);
    expect(await map.get('member-number')).toBe(9);
  });

  it('proves IdentifiedDataSerializable compatibility in both directions', async () => {
    const map = await hzClient.getMap<string, unknown>('interop-serialization-ids');
    await map.put('client', new ClientIds(1, 'client-ids'));

    const memberMap = cluster.getRunningInstances()[0]!.getMap<string, unknown>('interop-serialization-ids');
    expect(await memberMap.get('client')).toEqual(new MemberIds(1, 'client-ids'));

    await memberMap.put('member', new MemberIds(2, 'member-ids'));
    expect(await map.get('member')).toEqual(new ClientIds(2, 'member-ids'));
  });

  it('proves Portable compatibility in both directions on the official client boundary', async () => {
    const map = await hzClient.getMap<string, unknown>('interop-serialization-portable');
    await map.put('client', new ClientPortable(3, 'portable-client'));

    const memberMap = cluster.getRunningInstances()[0]!.getMap<string, unknown>('interop-serialization-portable');
    expect(await memberMap.get('client')).toEqual(new MemberPortable(3, 'portable-client'));

    await memberMap.put('member', new MemberPortable(4, 'portable-member'));
    expect(await map.get('member')).toEqual(new ClientPortable(4, 'portable-member'));
  });

  it('proves Compact compatibility in both directions on the official client boundary', async () => {
    const map = await hzClient.getMap<string, unknown>('interop-serialization-compact');
    await map.put('client', new ClientCompact(5, 'compact-client', null));

    const memberMap = cluster.getRunningInstances()[0]!.getMap<string, unknown>('interop-serialization-compact');
    expect(await memberMap.get('client')).toEqual(new MemberCompact(5, 'compact-client', null));

    await memberMap.put('member', new MemberCompact(6, 'compact-member', 41));
    expect(await map.get('member')).toEqual(new ClientCompact(6, 'compact-member', 41));
  });

  it('proves Compact GenericRecord compatibility in both directions on the official client boundary', async () => {
    const map = await hzClient.getMap<string, unknown>('interop-serialization-generic-record');
    const clientRecord = GenericRecords.compact(
      'interop-generic-record',
      { id: Fields.INT32, name: Fields.STRING, maybeAge: Fields.NULLABLE_INT32 },
      { id: 7, name: 'client-record', maybeAge: null },
    );
    await map.put('client', clientRecord);

    const memberMap = cluster.getRunningInstances()[0]!.getMap<string, any>('interop-serialization-generic-record');
    const memberRecord = await memberMap.get('client');
    expect(memberRecord.isCompact()).toBe(true);
    expect(memberRecord.getTypeName()).toBe('interop-generic-record');
    expect(memberRecord.getInt32('id')).toBe(7);
    expect(memberRecord.getString('name')).toBe('client-record');
    expect(memberRecord.getNullableInt32('maybeAge')).toBeNull();

    await memberMap.put('member', memberRecord.newBuilder()
      .setInt32('id', 8)
      .setString('name', 'member-record')
      .setNullableInt32('maybeAge', 12)
      .build());
    const clientRead = await map.get('member') as any;
    expect(clientRead.getSchema().typeName).toBe('interop-generic-record');
    expect(clientRead.getInt32('id')).toBe(8);
    expect(clientRead.getString('name')).toBe('member-record');
    expect(clientRead.getNullableInt32('maybeAge')).toBe(12);
  });

  it('proves retained collection and enum payloads across live client/member boundaries', async () => {
    const list = await hzClient.getList<DeliveryState>('interop-serialization-enum-list');
    await list.add(DeliveryState.READY);
    await list.add(DeliveryState.WAITING);

    const memberList = cluster.getRunningInstances()[0]!.getList<DeliveryState>('interop-serialization-enum-list');
    expect(await memberList.get(0)).toBe(DeliveryState.READY);
    expect(await memberList.get(1)).toBe(DeliveryState.WAITING);

    await memberList.add(DeliveryState.READY);
    expect(await list.get(2)).toBe(DeliveryState.READY);

    const set = await hzClient.getSet<DeliveryState>('interop-serialization-enum-set');
    await set.add(DeliveryState.READY);
    const memberSet = cluster.getRunningInstances()[0]!.getSet<DeliveryState>('interop-serialization-enum-set');
    expect(await memberSet.contains(DeliveryState.READY)).toBe(true);
  });

  it('proves retained custom and global serializer behavior across the client/member boundary', async () => {
    const map = await hzClient.getMap<string, unknown>('interop-serialization-custom');
    await map.put('client-custom', new CustomPayload('client-custom'));
    await map.put('client-global', { nested: 1n, ok: true });

    const memberMap = cluster.getRunningInstances()[0]!.getMap<string, unknown>('interop-serialization-custom');
    expect(await memberMap.get('client-custom')).toEqual(new CustomPayload('client-custom'));
    expect(await memberMap.get('client-global')).toEqual({ nested: '1', ok: true });

    await memberMap.put('member-custom', new CustomPayload('member-custom'));
    await memberMap.put('member-global', { nested: 2n, ok: false });
    expect(await map.get('member-custom')).toEqual(new CustomPayload('member-custom'));
    expect(await map.get('member-global')).toEqual({ nested: '2', ok: false });
  });
});

function clientConfig(clusterName: string, addresses: string[]): any {
  return {
    clusterName,
    network: { clusterMembers: addresses },
    serialization: {
      dataSerializableFactories: {
        [IDS_FACTORY_ID]: () => new ClientIds(),
      },
      portableFactories: {
        [PORTABLE_FACTORY_ID]: () => new ClientPortable(),
      },
      portableVersion: 0,
      compact: {
        serializers: [{
          getClass: () => ClientCompact,
          getTypeName: () => 'interop-compact',
          write: (writer: any, object: ClientCompact) => {
            writer.writeInt32('id', object.id);
            writer.writeString('name', object.name);
            writer.writeNullableInt32('maybeAge', object.maybeAge);
          },
          read: (reader: any) => new ClientCompact(reader.readInt32('id'), reader.readString('name'), reader.readNullableInt32('maybeAge')),
        }],
      },
      customSerializers: [{
        id: CUSTOM_SERIALIZER_ID,
        read: (inp: any) => new CustomPayload(inp.readString() ?? ''),
        write: (out: any, obj: CustomPayload) => out.writeString(obj.label),
      }],
      globalSerializer: {
        id: GLOBAL_SERIALIZER_ID,
        read: (inp: any) => JSON.parse(inp.readString() ?? 'null'),
        write: (out: any, obj: unknown) => out.writeString(JSON.stringify(obj, (_key, value) => typeof value === 'bigint' ? value.toString() : value)),
      },
    },
  };
}
