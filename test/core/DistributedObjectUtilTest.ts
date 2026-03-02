import { describe, test, expect } from 'bun:test';
import { DistributedObjectUtil } from '@helios/core/DistributedObjectUtil';
import type { DistributedObject } from '@helios/core/DistributedObject';
import type { PrefixedDistributedObject } from '@helios/core/PrefixedDistributedObject';

describe('DistributedObjectUtil', () => {
  test('getName returns object name', () => {
    const obj: DistributedObject = {
      getName: () => 'MockedDistributedObject',
      getServiceName: () => 'service',
      destroy: async () => {},
    };
    expect(DistributedObjectUtil.getName(obj)).toBe('MockedDistributedObject');
  });

  test('getName_withPrefixedDistributedObject returns prefixed name', () => {
    const obj: PrefixedDistributedObject = {
      getName: () => 'rawName',
      getPrefixedName: () => 'MockedPrefixedDistributedObject',
      getServiceName: () => 'service',
      destroy: async () => {},
    };
    expect(DistributedObjectUtil.getName(obj)).toBe('MockedPrefixedDistributedObject');
  });
});
