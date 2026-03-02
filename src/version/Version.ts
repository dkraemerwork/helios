/**
 * Version pattern: major.minor with optional patch, suffix, and SNAPSHOT qualifier.
 * Groups: [1]=major [2]=minor [3]=.patch [4]=patch [5]=suffix [6]=-SNAPSHOT
 */
const VERSION_PATTERN = /^(\d+)\.(\d+)(\.(\d+))?(-\w+(?:-\d+)?)?(-SNAPSHOT)?$/;

/** @internal */
export function tokenizeVersionString(version: string): string[] | null {
  const m = VERSION_PATTERN.exec(version);
  if (!m) return null;
  // Return array indexed 1-based groups as 0-based slots (matching Java behavior)
  return [m[1], m[2], m[3], m[4], m[5], m[6]];
}

/**
 * A MAJOR.MINOR cluster/serialization version (port of com.hazelcast.version.Version).
 *
 * Special value: UNKNOWN (0.0) — participates in comparisons with defined semantics.
 * See Java source for full behavioral contract.
 */
export class Version implements Comparable<Version> {
  /** Sentinel value used to represent UNKNOWN major and minor */
  static readonly UNKNOWN_VERSION: number = 0;

  /** The UNKNOWN version constant (0.0). Only equal to itself. */
  static readonly UNKNOWN: Version = new Version(0, 0);

  readonly #major: number;
  readonly #minor: number;

  /** No-arg constructor produces UNKNOWN (0.0) */
  constructor();
  constructor(major: number, minor: number);
  constructor(major = 0, minor = 0) {
    this.#major = major;
    this.#minor = minor;
  }

  getMajor(): number { return this.#major; }
  getMinor(): number { return this.#minor; }

  // ── Factory ────────────────────────────────────────────────────────────────

  /** Create a Version from major and minor integers. Returns UNKNOWN for (0,0). */
  static of(major: number, minor: number): Version;
  /** Parse a version string like "3.8". Throws IllegalArgumentException on failure. */
  static of(version: string): Version;
  static of(majorOrStr: number | string, minor?: number): Version {
    if (typeof majorOrStr === 'string') {
      const tokens = tokenizeVersionString(majorOrStr);
      if (tokens && tokens[0] != null && tokens[1] != null) {
        return Version.of(parseInt(tokens[0], 10), parseInt(tokens[1], 10));
      }
      throw new Error(`Cannot parse ${majorOrStr} to ClusterVersion.`);
    }
    const major = majorOrStr;
    if (major === Version.UNKNOWN_VERSION && minor === Version.UNKNOWN_VERSION) {
      return Version.UNKNOWN;
    }
    return new Version(major, minor!);
  }

  // ── Comparison predicates ─────────────────────────────────────────────────

  isEqualTo(version: Version): boolean {
    return this.#major === version.#major && this.#minor === version.#minor;
  }

  /**
   * Returns true if this > version.
   * Returns false when either operand is UNKNOWN.
   */
  isGreaterThan(version: Version): boolean {
    return !version.isUnknown() && this.compareTo(version) > 0;
  }

  /** Returns true if this is UNKNOWN, or this > version (excluding UNKNOWN argument). */
  isUnknownOrGreaterThan(version: Version): boolean {
    return this.isUnknown() || (!version.isUnknown() && this.compareTo(version) > 0);
  }

  /** Returns true if this >= version. Both must be known; or both UNKNOWN. */
  isGreaterOrEqual(version: Version): boolean {
    return (!version.isUnknown() && this.compareTo(version) >= 0)
      || (version.isUnknown() && this.isUnknown());
  }

  /** Returns true if this is UNKNOWN, or this >= version (excluding UNKNOWN argument). */
  isUnknownOrGreaterOrEqual(version: Version): boolean {
    return this.isUnknown() || (!version.isUnknown() && this.compareTo(version) >= 0);
  }

  /** Returns true if this < version. UNKNOWN is not less than anything. */
  isLessThan(version: Version): boolean {
    return !this.isUnknown() && this.compareTo(version) < 0;
  }

  /** Returns true if this is UNKNOWN, or this < version. */
  isUnknownOrLessThan(version: Version): boolean {
    return this.isUnknown() || this.compareTo(version) < 0;
  }

  /** Returns true if this <= version. Both must be known; or both UNKNOWN. */
  isLessOrEqual(version: Version): boolean {
    return (!this.isUnknown() && this.compareTo(version) <= 0)
      || (this.isUnknown() && version.isUnknown());
  }

  /** Returns true if this is UNKNOWN, or this <= version. */
  isUnknownOrLessOrEqual(version: Version): boolean {
    return this.isUnknown() || this.compareTo(version) <= 0;
  }

  /** Returns true if this is in [from, to] (both inclusive). */
  isBetween(from: Version, to: Version): boolean {
    const v = this.#pack();
    return v >= from.#pack() && v <= to.#pack();
  }

  /** Returns true when this version is 0.0 (UNKNOWN). */
  isUnknown(): boolean {
    return this.#pack() === Version.UNKNOWN_VERSION;
  }

  compareTo(other: Version): number {
    return this.#pack() - other.#pack();
  }

  // ── Object identity ───────────────────────────────────────────────────────

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof Version)) return false;
    return this.isEqualTo(other);
  }

  hashCode(): number {
    return (31 * (this.#major & 0xff) + (this.#minor & 0xff)) | 0;
  }

  toString(): string {
    return `${this.#major}.${this.#minor}`;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  #pack(): number {
    return ((this.#major << 8) & 0xff00) | (this.#minor & 0xff);
  }
}

/** Marker interface for Comparable objects (structural, TypeScript-style). */
interface Comparable<T> {
  compareTo(other: T): number;
}
