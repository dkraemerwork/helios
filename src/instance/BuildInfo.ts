import { tokenizeVersionString } from '@zenystx/core/version/Version';

/**
 * Build information for the Helios runtime.
 * Port of com.hazelcast.instance.BuildInfo.
 */
export class BuildInfo {
  static readonly UNKNOWN_HAZELCAST_VERSION = -1;

  private static readonly MAJOR_VERSION_MULTIPLIER = 10000;
  private static readonly MINOR_VERSION_MULTIPLIER = 100;
  private static readonly PATCH_TOKEN_INDEX = 3;

  constructor(
    private readonly version: string,
    private readonly build: string,
    private readonly revision: string,
    private readonly buildNumber: number,
    private readonly enterprise: boolean,
    private readonly serializationVersion: number,
    private readonly commitId: string,
  ) {}

  getVersion(): string { return this.version; }
  getBuild(): string { return this.build; }
  getRevision(): string { return this.revision; }
  getBuildNumber(): number { return this.buildNumber; }
  isEnterprise(): boolean { return this.enterprise; }
  getSerializationVersion(): number { return this.serializationVersion; }
  getCommitId(): string { return this.commitId; }

  toString(): string {
    return `BuildInfo{version='${this.version}', build='${this.build}', buildNumber=${this.buildNumber}, `
      + `revision=${this.revision}, enterprise=${this.enterprise}}`;
  }

  /**
   * Calculates an integer version from a version string (e.g. "3.7.2" → 30702).
   * Returns UNKNOWN_HAZELCAST_VERSION (-1) if the version string is invalid.
   */
  static calculateVersion(version: string | null): number {
    if (version == null || version === '') {
      return BuildInfo.UNKNOWN_HAZELCAST_VERSION;
    }

    const tokens = tokenizeVersionString(version);
    if (tokens == null) {
      return BuildInfo.UNKNOWN_HAZELCAST_VERSION;
    }

    try {
      const major = parseInt(tokens[0]!, 10);
      const minor = parseInt(tokens[1]!, 10);
      if (isNaN(major) || isNaN(minor)) {
        return BuildInfo.UNKNOWN_HAZELCAST_VERSION;
      }

      let calculated = BuildInfo.MAJOR_VERSION_MULTIPLIER * major
        + BuildInfo.MINOR_VERSION_MULTIPLIER * minor;

      // tokens[3] = patch number (index 3 in the 0-based TS array = group 4 in regex)
      const patchToken = tokens[BuildInfo.PATCH_TOKEN_INDEX];
      if (patchToken != null && !patchToken.startsWith('-')) {
        const patch = parseInt(patchToken, 10);
        if (!isNaN(patch)) {
          calculated += patch;
        }
      }

      return calculated;
    } catch {
      return BuildInfo.UNKNOWN_HAZELCAST_VERSION;
    }
  }
}
