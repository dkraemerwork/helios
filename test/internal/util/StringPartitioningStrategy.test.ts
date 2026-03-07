import { StringPartitioningStrategy } from '@zenystx/helios-core/internal/util/StringPartitioningStrategy';
import { describe, expect, it } from 'bun:test';

describe('StringPartitioningStrategyTest', () => {
  it('testGetBaseName', () => {
    expect(StringPartitioningStrategy.getBaseName('foo')).toEqual('foo');
    expect(StringPartitioningStrategy.getBaseName('')).toEqual('');
    expect(StringPartitioningStrategy.getBaseName(null)).toBeNull();
    expect(StringPartitioningStrategy.getBaseName('foo@bar')).toEqual('foo');
    expect(StringPartitioningStrategy.getBaseName('foo@')).toEqual('foo');
    expect(StringPartitioningStrategy.getBaseName('@bar')).toEqual('');
    expect(StringPartitioningStrategy.getBaseName('foo@bar@nii')).toEqual('foo');
  });

  it('testGetPartitionKey', () => {
    expect(StringPartitioningStrategy.getPartitionKey('foo')).toEqual('foo');
    expect(StringPartitioningStrategy.getPartitionKey('')).toEqual('');
    expect(StringPartitioningStrategy.getPartitionKey(null)).toBeNull();
    expect(StringPartitioningStrategy.getPartitionKey('foo@bar')).toEqual('bar');
    expect(StringPartitioningStrategy.getPartitionKey('foo@')).toEqual('');
    expect(StringPartitioningStrategy.getPartitionKey('@bar')).toEqual('bar');
    expect(StringPartitioningStrategy.getPartitionKey('foo@bar@nii')).toEqual('bar@nii');
  });
});
