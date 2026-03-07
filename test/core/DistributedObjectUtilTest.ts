import type { DistributedObject } from '@zenystx/helios-core/core/DistributedObject';
import { DistributedObjectUtil } from '@zenystx/helios-core/core/DistributedObjectUtil';
import type { PrefixedDistributedObject } from '@zenystx/helios-core/core/PrefixedDistributedObject';
import { describe, expect, test } from 'bun:test';

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
