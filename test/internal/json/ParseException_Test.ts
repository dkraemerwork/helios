import { describe, it, expect, beforeEach } from 'bun:test';
import { Location } from '@zenystx/helios-core/internal/json/Location';
import { ParseException } from '@zenystx/helios-core/internal/json/ParseException';

describe('ParseException_Test', () => {
  let location: Location;

  beforeEach(() => {
    location = new Location(4711, 23, 42);
  });

  it('location', () => {
    const exception = new ParseException('Foo', location);
    expect(exception.getLocation()).toBe(location);
  });

  it('message', () => {
    const exception = new ParseException('Foo', location);
    expect(exception.message).toBe('Foo at 23:42');
  });
});
