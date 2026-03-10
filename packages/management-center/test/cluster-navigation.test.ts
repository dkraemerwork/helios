import { describe, expect, test } from 'bun:test';
import {
  extractClusterIdFromUrl,
  resolveClusterBasePath,
  resolveShellNavigationLink,
  resolvePlaceholderClusterUrl,
} from '../frontend/src/app/shell/cluster-navigation';

describe('cluster navigation helpers', () => {
  test('preserves the destination path when replacing the placeholder cluster id', () => {
    expect(resolvePlaceholderClusterUrl('/clusters/_/jobs', 'stress')).toBe('/clusters/stress/jobs');
    expect(resolvePlaceholderClusterUrl('/clusters/_/data/maps/orders?tab=stats', 'stress')).toBe(
      '/clusters/stress/data/maps/orders?tab=stats',
    );
  });

  test('derives the cluster base path from the router url before the store hydrates', () => {
    expect(resolveClusterBasePath(null, '/clusters/stress/jobs')).toBe('/clusters/stress');
    expect(resolveClusterBasePath('alpha', '/clusters/stress/jobs')).toBe('/clusters/alpha');
  });

  test('keeps cluster-scoped shell links under the active cluster route', () => {
    expect(resolveShellNavigationLink('/jobs', 'cluster', null, '/clusters/stress')).toBe('/clusters/stress/jobs');
    expect(resolveShellNavigationLink('/config', 'cluster', null, '/clusters/stress/jobs')).toBe('/clusters/stress/config');
    expect(resolveShellNavigationLink('/admin', 'cluster', 'alpha', '/settings')).toBe('/clusters/alpha/admin');
  });

  test('keeps global shell links outside the cluster placeholder namespace', () => {
    expect(resolveShellNavigationLink('/settings', 'global', null, '/clusters/_/jobs')).toBe('/settings');
    expect(resolveShellNavigationLink('/users', 'global', 'alpha', '/clusters/alpha/admin')).toBe('/users');
  });

  test('extracts the active cluster id from cluster routes only', () => {
    expect(extractClusterIdFromUrl('/clusters/stress/jobs')).toBe('stress');
    expect(extractClusterIdFromUrl('/settings')).toBeNull();
  });
});
