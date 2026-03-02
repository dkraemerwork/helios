import { describe, test, expect, afterEach } from 'bun:test';
import { BuildInfo } from '@helios/instance/BuildInfo';
import { BuildInfoProvider } from '@helios/instance/BuildInfoProvider';

describe('BuildInfo.calculateVersion', () => {
  test('invalid versions return -1', () => {
    expect(BuildInfo.calculateVersion(null)).toBe(-1);
    expect(BuildInfo.calculateVersion('')).toBe(-1);
    expect(BuildInfo.calculateVersion('a.3.7.5')).toBe(-1);
    expect(BuildInfo.calculateVersion('3.a.5')).toBe(-1);
    expect(BuildInfo.calculateVersion('3,7.5')).toBe(-1);
    expect(BuildInfo.calculateVersion('3.7,5')).toBe(-1);
    expect(BuildInfo.calculateVersion('10.99.RC1')).toBe(-1);
  });

  test('valid versions are calculated correctly', () => {
    expect(BuildInfo.calculateVersion('3.7-SNAPSHOT')).toBe(30700);
    expect(BuildInfo.calculateVersion('3.7.2')).toBe(30702);
    expect(BuildInfo.calculateVersion('3.7.2-SNAPSHOT')).toBe(30702);
    expect(BuildInfo.calculateVersion('10.99.2-SNAPSHOT')).toBe(109902);
    expect(BuildInfo.calculateVersion('1.99.30')).toBe(19930);
    expect(BuildInfo.calculateVersion('10.99.30-SNAPSHOT')).toBe(109930);
    expect(BuildInfo.calculateVersion('10.99-RC1')).toBe(109900);
  });
});

describe('BuildInfoProvider', () => {
  afterEach(() => {
    delete process.env[BuildInfoProvider.HAZELCAST_INTERNAL_OVERRIDE_VERSION];
    delete process.env[BuildInfoProvider.HAZELCAST_INTERNAL_OVERRIDE_ENTERPRISE];
    delete process.env['hazelcast.build'];
  });

  test('getBuildInfo returns version matching VERSION_PATTERN', () => {
    const info = BuildInfoProvider.getBuildInfo();
    expect(info.getVersion()).toMatch(/^\d+\.\d+(\.\d+)?(-\w+)?(-SNAPSHOT)?$/);
  });

  test('getBuildInfo enterprise defaults to false', () => {
    const info = BuildInfoProvider.getBuildInfo();
    expect(info.isEnterprise()).toBe(false);
  });

  test('override version via env', () => {
    process.env[BuildInfoProvider.HAZELCAST_INTERNAL_OVERRIDE_VERSION] = '99.99.99';
    const info = BuildInfoProvider.getBuildInfo();
    expect(info.getVersion()).toBe('99.99.99');
  });

  test('override enterprise via env', () => {
    process.env[BuildInfoProvider.HAZELCAST_INTERNAL_OVERRIDE_ENTERPRISE] = 'true';
    const info = BuildInfoProvider.getBuildInfo();
    expect(info.isEnterprise()).toBe(true);
  });

  test('override build number via env', () => {
    process.env['hazelcast.build'] = '2';
    const info = BuildInfoProvider.getBuildInfo();
    expect(info.getBuild()).toBe('2');
    expect(info.getBuildNumber()).toBe(2);
  });

  test('commitId starts with revision', () => {
    const info = BuildInfoProvider.getBuildInfo();
    // empty revision is a valid "prefix" of commitId
    expect(info.getCommitId().startsWith(info.getRevision())).toBe(true);
  });
});
