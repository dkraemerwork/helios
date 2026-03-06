import { describe, it, expect, beforeEach } from 'bun:test';
import { ReplicatedRecord } from '@zenystx/core/replicatedmap/impl/record/ReplicatedRecord';

describe('ReplicatedRecordTest', () => {
  let replicatedRecord: ReplicatedRecord<string, string>;
  let replicatedRecordSameAttributes: ReplicatedRecord<string, string>;
  let replicatedRecordOtherKey: ReplicatedRecord<string, string>;
  let replicatedRecordOtherValue: ReplicatedRecord<string, string>;
  let replicatedRecordOtherTtl: ReplicatedRecord<string, string>;

  beforeEach(() => {
    replicatedRecord = new ReplicatedRecord('key', 'value', 0);
    replicatedRecordSameAttributes = new ReplicatedRecord('key', 'value', 0);
    replicatedRecordOtherKey = new ReplicatedRecord('otherKey', 'value', 0);
    replicatedRecordOtherValue = new ReplicatedRecord('key', 'otherValue', 0);
    replicatedRecordOtherTtl = new ReplicatedRecord('key', 'value', 1);
  });

  it('testGetKey', () => {
    expect(replicatedRecord.getHits()).toBe(0);
    expect(replicatedRecord.getKey()).toBe('key');
    expect(replicatedRecord.getHits()).toBe(1);
  });

  it('testGetKeyInternal', () => {
    expect(replicatedRecord.getHits()).toBe(0);
    expect(replicatedRecord.getKeyInternal()).toBe('key');
    expect(replicatedRecord.getHits()).toBe(0);
  });

  it('testGetValue', () => {
    expect(replicatedRecord.getHits()).toBe(0);
    expect(replicatedRecord.getValue()).toBe('value');
    expect(replicatedRecord.getHits()).toBe(1);
  });

  it('testGetValueInternal', () => {
    expect(replicatedRecord.getHits()).toBe(0);
    expect(replicatedRecord.getValueInternal()).toBe('value');
    expect(replicatedRecord.getHits()).toBe(0);
  });

  it('testGetTtlMillis', () => {
    expect(replicatedRecord.getTtlMillis()).toBe(0);
    expect(replicatedRecordOtherTtl.getTtlMillis()).toBe(1);
  });

  it('testSetValue', () => {
    expect(replicatedRecord.getHits()).toBe(0);
    expect(replicatedRecord.getValueInternal()).toBe('value');

    replicatedRecord.setValue('newValue', 0);

    expect(replicatedRecord.getHits()).toBe(1);
    expect(replicatedRecord.getValueInternal()).toBe('newValue');
  });

  it('testSetValueInternal', () => {
    expect(replicatedRecord.getHits()).toBe(0);
    expect(replicatedRecord.getValueInternal()).toBe('value');

    replicatedRecord.setValueInternal('newValue', 0);

    expect(replicatedRecord.getHits()).toBe(0);
    expect(replicatedRecord.getValueInternal()).toBe('newValue');
  });

  it('testGetUpdateTime', async () => {
    const lastUpdateTime = replicatedRecord.getUpdateTime();
    await new Promise(r => setTimeout(r, 150));

    replicatedRecord.setValue('newValue', 0);
    expect(replicatedRecord.getUpdateTime()).toBeGreaterThan(lastUpdateTime);
  });

  it('testSetUpdateTime', () => {
    replicatedRecord.setUpdateTime(2342);
    expect(replicatedRecord.getUpdateTime()).toBe(2342);
  });

  it('testSetHits', () => {
    replicatedRecord.setHits(4223);
    expect(replicatedRecord.getHits()).toBe(4223);
  });

  it('getLastAccessTime', async () => {
    const lastAccessTime = replicatedRecord.getLastAccessTime();
    await new Promise(r => setTimeout(r, 150));

    replicatedRecord.setValue('newValue', 0);
    expect(replicatedRecord.getLastAccessTime()).toBeGreaterThan(lastAccessTime);
  });

  it('testSetAccessTime', () => {
    replicatedRecord.setLastAccessTime(1234);
    expect(replicatedRecord.getLastAccessTime()).toBe(1234);
  });

  it('testCreationTime', () => {
    replicatedRecord.setCreationTime(4321);
    expect(replicatedRecord.getCreationTime()).toBe(4321);
  });

  it('testEquals', () => {
    expect(replicatedRecord.equals(replicatedRecord)).toBe(true);
    expect(replicatedRecord.equals(replicatedRecordSameAttributes)).toBe(true);

    expect(replicatedRecord.equals(null)).toBe(false);
    expect(replicatedRecord.equals(new Object())).toBe(false);

    expect(replicatedRecord.equals(replicatedRecordOtherKey)).toBe(false);
    expect(replicatedRecord.equals(replicatedRecordOtherValue)).toBe(false);
    expect(replicatedRecord.equals(replicatedRecordOtherTtl)).toBe(false);
  });

  it('testHashCode', () => {
    expect(replicatedRecord.hashCode()).toBe(replicatedRecord.hashCode());
    expect(replicatedRecord.hashCode()).toBe(replicatedRecordSameAttributes.hashCode());

    // Different keys/values/ttl should generally produce different hashcodes
    // (not guaranteed but highly likely for these simple values)
    expect(replicatedRecord.hashCode()).not.toBe(replicatedRecordOtherKey.hashCode());
    expect(replicatedRecord.hashCode()).not.toBe(replicatedRecordOtherValue.hashCode());
    expect(replicatedRecord.hashCode()).not.toBe(replicatedRecordOtherTtl.hashCode());
  });

  it('testToString', () => {
    expect(replicatedRecord.toString()).not.toBeNull();
    expect(typeof replicatedRecord.toString()).toBe('string');
  });
});
