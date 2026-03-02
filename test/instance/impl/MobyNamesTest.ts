import { describe, test, expect, afterEach } from 'bun:test';
import { MobyNames } from '@helios/instance/impl/MobyNames';

describe('MobyNames', () => {
  afterEach(() => {
    delete process.env[MobyNames.MOBY_NAMING_PREFIX];
  });

  test('getRandomNameNotEmpty', () => {
    const randomName = MobyNames.getRandomName(0);
    expect(randomName.trim()).not.toBe('');
  });

  test('getRandomNameWithPrefix', () => {
    process.env[MobyNames.MOBY_NAMING_PREFIX] = 'foo';
    const randomName = MobyNames.getRandomName(0);
    expect(randomName.trim()).not.toBe('');
    expect(randomName.startsWith('foo_')).toBe(true);
  });

  test('allValuesReturnedFair', () => {
    const totalCombinations = 98 * 240; // LEFT.length * RIGHT.length
    const namesCounts = new Map<string, number>();
    for (let i = 0; i < totalCombinations * 2; i++) {
      const randomName = MobyNames.getRandomName(i);
      namesCounts.set(randomName, (namesCounts.get(randomName) ?? 0) + 1);
    }
    expect(namesCounts.size).toBe(totalCombinations);
    for (const name of namesCounts.keys()) {
      expect(name.trim()).not.toBe('');
    }
    for (const [name, count] of namesCounts) {
      expect(count).toBe(2); // each name appears exactly twice
    }
  });
});
