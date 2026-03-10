const CLUSTER_PLACEHOLDER_SEGMENT = '/clusters/_';
const CLUSTER_SEGMENT_PATTERN = /\/clusters\/([^/?#]+)/;

export type ShellNavigationScope = 'cluster' | 'global';

export function extractClusterIdFromUrl(url: string): string | null {
  const match = url.match(CLUSTER_SEGMENT_PATTERN);
  return match?.[1] ?? null;
}

export function resolveClusterBasePath(activeClusterId: string | null, currentUrl: string): string {
  const clusterId = activeClusterId ?? extractClusterIdFromUrl(currentUrl);
  return clusterId ? `/clusters/${clusterId}` : '/clusters/_';
}

export function resolveShellNavigationLink(
  targetPath: string,
  scope: ShellNavigationScope,
  activeClusterId: string | null,
  currentUrl: string,
): string {
  if (scope === 'global') {
    return targetPath;
  }

  return `${resolveClusterBasePath(activeClusterId, currentUrl)}${targetPath}`;
}

export function resolvePlaceholderClusterUrl(currentUrl: string, clusterId: string): string {
  if (currentUrl === '/' || currentUrl === '') {
    return `/clusters/${clusterId}`;
  }

  if (!currentUrl.includes(CLUSTER_PLACEHOLDER_SEGMENT)) {
    return currentUrl;
  }

  return currentUrl.replace(CLUSTER_PLACEHOLDER_SEGMENT, `/clusters/${clusterId}`);
}
