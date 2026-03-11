import { Client } from 'hazelcast-client';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HeliosTestCluster } from '../helpers/HeliosTestCluster';

describe('Official Client - SQL', () => {
  let cluster: HeliosTestCluster;
  let hzClient: Awaited<ReturnType<typeof Client.newHazelcastClient>>;

  beforeEach(async () => {
    cluster = new HeliosTestCluster();
    const { clusterName, addresses } = await cluster.startSingle();
    hzClient = await Client.newHazelcastClient({
      clusterName,
      network: { clusterMembers: addresses },
    });
  });

  afterEach(async () => {
    try { await hzClient.shutdown(); } catch { }
    await cluster.shutdown();
  });

  it('executes retained SELECT with parameter binding and cursor paging', async () => {
    const map = await hzClient.getMap<string, { name: string; age: number }>('sql-people-select');
    await map.put('1', { name: 'Ada', age: 36 });
    await map.put('2', { name: 'Bob', age: 24 });
    await map.put('3', { name: 'Grace', age: 42 });

    const result = await hzClient.getSql().execute(
      'SELECT name, age FROM sql-people-select WHERE age >= ? ORDER BY name',
      [30],
      { cursorBufferSize: 1 },
    );

    expect(result.isRowSet()).toBe(true);
    expect(result.rowMetadata?.getColumns().map((column) => column.name)).toEqual(['name', 'age']);

    const first = await result.next();
    const second = await result.next();
    const done = await result.next();

    expect(first).toMatchObject({ done: false, value: { name: 'Ada', age: 36 } });
    expect(second).toMatchObject({ done: false, value: { name: 'Grace', age: 42 } });
    expect(done.done).toBe(true);
  });

  it('supports retained INSERT, UPDATE, and DELETE update counts', async () => {
    const map = await hzClient.getMap<string, { name: string; age: number }>('sql-people-dml');

    const insertResult = await hzClient.getSql().execute(
      'INSERT INTO sql-people-dml (__key, name, age) VALUES (?, ?, ?)',
      ['1', 'Ada', 36],
    );
    expect(insertResult.isRowSet()).toBe(false);
    expect(insertResult.updateCount.toString()).toBe('1');
    expect(await map.get('1')).toEqual({ name: 'Ada', age: 36 });

    const updateResult = await hzClient.getSql().execute(
      'UPDATE sql-people-dml SET age = ? WHERE __key = ?',
      [37, '1'],
    );
    expect(updateResult.updateCount.toString()).toBe('1');
    expect(await map.get('1')).toEqual({ name: 'Ada', age: 37 });

    const deleteResult = await hzClient.getSql().execute(
      'DELETE FROM sql-people-dml WHERE __key = ?',
      ['1'],
    );
    expect(deleteResult.updateCount.toString()).toBe('1');
    expect(await map.get('1')).toBeNull();
  });

  it('closes retained cursors and fails closed on further fetches', async () => {
    const map = await hzClient.getMap<string, { name: string }>('sql-people-close');
    await map.put('1', { name: 'Ada' });
    await map.put('2', { name: 'Grace' });

    const result = await hzClient.getSql().execute(
      'SELECT name FROM sql-people-close ORDER BY name',
      [],
      { cursorBufferSize: 1 },
    );

    expect(await result.next()).toMatchObject({ done: false, value: { name: 'Ada' } });
    await result.close();
    await expect(result.next()).rejects.toThrow(/closed|cancelled/i);
  });

  it('rejects unsupported schema, statement classes, and result-type mismatches honestly', async () => {
    const map = await hzClient.getMap<string, { name: string }>('sql-people-negative');
    await map.put('1', { name: 'Ada' });

    await expect(hzClient.getSql().execute(
      'SELECT name FROM sql-people-negative',
      [],
      { schema: 'tenant_a' },
    )).rejects.toThrow(/default schema/i);

    await expect(hzClient.getSql().execute(
      'MERGE INTO sql-people-negative (__key, name) VALUES (?, ?)',
      ['2', 'Grace'],
    )).rejects.toThrow(/unsupported sql statement type/i);

    await expect(hzClient.getSql().execute(
      'SELECT name FROM sql-people-negative',
      [],
      { expectedResultType: 'UPDATE_COUNT' },
    )).rejects.toThrow(/update count was required/i);
  });
});
