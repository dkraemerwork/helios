import { describe, test, expect } from 'bun:test';
import { DistributedObjectUtil } from '@zenystx/helios-core/core/DistributedObjectUtil';
import type { DistributedObject } from '@zenystx/helios-core/core/DistributedObject';
import type { PrefixedDistributedObject } from '@zenystx/helios-core/core/PrefixedDistributedObject';

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
