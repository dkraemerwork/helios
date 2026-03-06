import { BuildInfo } from '@zenystx/helios-core/instance/BuildInfo';

// Helios build properties (equivalent to GeneratedBuildProperties in Java)
// These values represent the current Helios port version
const HELIOS_VERSION = '1.0.0-SNAPSHOT';
const HELIOS_BUILD = '0';
const HELIOS_REVISION = '';
const HELIOS_COMMIT_ID = '';
const HELIOS_SERIALIZATION_VERSION = 1;

/**
 * Provides build information for the Helios runtime.
 * Port of com.hazelcast.instance.BuildInfoProvider.
 */
export class BuildInfoProvider {
  static readonly HAZELCAST_INTERNAL_OVERRIDE_VERSION = 'hazelcast.internal.override.version';
  static readonly HAZELCAST_INTERNAL_OVERRIDE_ENTERPRISE = 'hazelcast.internal.override.enterprise';
  static readonly HAZELCAST_INTERNAL_OVERRIDE_BUILD = 'hazelcast.build';

  private static readonly _cache: BuildInfo = BuildInfoProvider._buildDefault();

  private constructor() {}

  private static _buildDefault(): BuildInfo {
    return new BuildInfo(
      HELIOS_VERSION,
      HELIOS_BUILD,
      HELIOS_REVISION,
      parseInt(HELIOS_BUILD, 10),
      false,
      HELIOS_SERIALIZATION_VERSION,
      HELIOS_COMMIT_ID,
    );
  }

  /**
   * Returns the current build info. Supports env-var overrides for testing.
   */
  static getBuildInfo(): BuildInfo {
    const overrideVersion = process.env[BuildInfoProvider.HAZELCAST_INTERNAL_OVERRIDE_VERSION];
    const overrideEnterprise = process.env[BuildInfoProvider.HAZELCAST_INTERNAL_OVERRIDE_ENTERPRISE];
    const overrideBuild = process.env[BuildInfoProvider.HAZELCAST_INTERNAL_OVERRIDE_BUILD];

    if (overrideVersion == null && overrideEnterprise == null && overrideBuild == null) {
      return BuildInfoProvider._cache;
    }

    // apply overrides
    let version = HELIOS_VERSION;
    let build = HELIOS_BUILD;
    let buildNumber = parseInt(HELIOS_BUILD, 10);
    let enterprise = false;
    let revision = HELIOS_REVISION;
    let commitId = HELIOS_COMMIT_ID;

    if (overrideVersion != null) {
      version = overrideVersion;
    }
    if (overrideEnterprise != null) {
      enterprise = overrideEnterprise.toLowerCase() === 'true';
    }
    if (overrideBuild != null) {
      build = overrideBuild;
      buildNumber = parseInt(overrideBuild, 10);
    }

    return new BuildInfo(version, build, revision, buildNumber, enterprise, HELIOS_SERIALIZATION_VERSION, commitId);
  }
}
