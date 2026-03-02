import { tokenizeVersionString, Version } from '@helios/version/Version';

/** String representation of the UNKNOWN version. */
const UNKNOWN_VERSION_STRING = '0.0.0';

/**
 * Compares two MemberVersions on major and minor only, ignoring patch.
 * Port of com.hazelcast.version.MajorMinorVersionComparator.
 */
function majorMinorVersionComparator(o1: MemberVersion, o2: MemberVersion): number {
  const v1 = ((o1.getMajor() << 8) & 0xff00) | (o1.getMinor() & 0xff);
  const v2 = ((o2.getMajor() << 8) & 0xff00) | (o2.getMinor() & 0xff);
  if (v1 > v2) return 1;
  return v1 === v2 ? 0 : -1;
}

/**
 * Hazelcast member version (major.minor.patch).
 * Port of com.hazelcast.version.MemberVersion.
 *
 * Special value: UNKNOWN (0.0.0). `isUnknown()` returns true iff all three are 0.
 */
export class MemberVersion {
  /** The UNKNOWN member version (0.0.0). */
  static readonly UNKNOWN: MemberVersion = new MemberVersion(0, 0, 0);

  /**
   * Comparator that compares only major.minor, ignoring patch.
   * Returns negative/zero/positive like a standard comparator function.
   */
  static readonly MAJOR_MINOR_VERSION_COMPARATOR: (a: MemberVersion, b: MemberVersion) => number =
    majorMinorVersionComparator;

  #major: number;
  #minor: number;
  #patch: number;

  /** No-arg constructor — produces version 0.0.0 (UNKNOWN). */
  constructor();
  constructor(major: number, minor: number, patch: number);
  constructor(major = 0, minor = 0, patch = 0) {
    this.#major = major;
    this.#minor = minor;
    this.#patch = patch;
  }

  getMajor(): number { return this.#major; }
  getMinor(): number { return this.#minor; }
  getPatch(): number { return this.#patch; }

  isUnknown(): boolean {
    return this.#major === 0 && this.#minor === 0 && this.#patch === 0;
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  /** Create a MemberVersion from integers. Returns UNKNOWN for (0,0,0). */
  static of(major: number, minor: number, patch: number): MemberVersion;
  /** Parse a version string. Returns UNKNOWN for null/"0.0.0". */
  static of(version: string | null | undefined): MemberVersion;
  static of(
    majorOrStr: number | string | null | undefined,
    minor?: number,
    patch?: number,
  ): MemberVersion {
    if (typeof majorOrStr === 'number') {
      if (majorOrStr === 0 && minor === 0 && patch === 0) return MemberVersion.UNKNOWN;
      return new MemberVersion(majorOrStr, minor!, patch!);
    }
    // string / null / undefined path
    if (majorOrStr == null || majorOrStr.startsWith(UNKNOWN_VERSION_STRING)) {
      return MemberVersion.UNKNOWN;
    }
    return MemberVersion.#parse(majorOrStr);
  }

  static #parse(version: string): MemberVersion {
    const tokens = tokenizeVersionString(version);
    if (!tokens || tokens[0] == null || tokens[1] == null) {
      throw new Error(`Cannot parse '${version}' to MemberVersion.`);
    }
    const major = parseInt(tokens[0], 10);
    const minor = parseInt(tokens[1], 10);
    // tokens[3] is the patch digit group (group 4 in Java: index 3)
    const patch = tokens[3] != null ? parseInt(tokens[3], 10) : 0;
    return MemberVersion.of(major, minor, patch);
  }

  // ── Comparison ────────────────────────────────────────────────────────────

  compareTo(other: MemberVersion): number {
    const v1 = ((this.#major << 16) & 0xff0000)
      | ((this.#minor << 8) & 0xff00)
      | (this.#patch & 0xff);
    const v2 = ((other.#major << 16) & 0xff0000)
      | ((other.#minor << 8) & 0xff00)
      | (other.#patch & 0xff);
    if (v1 > v2) return 1;
    return v1 === v2 ? 0 : -1;
  }

  isGreaterOrEqual(version: MemberVersion): boolean {
    return (!version.isUnknown() && this.compareTo(version) >= 0)
      || (version.isUnknown() && this.isUnknown());
  }

  /** @return a Version with the same major.minor as this MemberVersion. */
  asVersion(): Version {
    return Version.of(this.#major, this.#minor);
  }

  // ── Object identity ───────────────────────────────────────────────────────

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof MemberVersion)) return false;
    return this.#major === other.#major
      && this.#minor === other.#minor
      && this.#patch === other.#patch;
  }

  hashCode(): number {
    let result = this.#major & 0xff;
    result = (31 * result + (this.#minor & 0xff)) | 0;
    result = (31 * result + (this.#patch & 0xff)) | 0;
    return result;
  }

  toString(): string {
    return `${this.#major}.${this.#minor}.${this.#patch}`;
  }
}
