/**
 * TaggedMetric — a named, valued metric with an associated tag map.
 *
 * Mirrors Hazelcast Jet's internal metric descriptor model: every metric
 * carries both its numeric value and a set of key/value tags that describe
 * its origin (job, vertex, member, etc.).
 */
export class TaggedMetric {
  readonly name: string;
  readonly value: number;
  readonly tags: ReadonlyMap<string, string>;

  constructor(name: string, value: number, tags: ReadonlyMap<string, string>) {
    this.name = name;
    this.value = value;
    this.tags = tags;
  }

  /**
   * Serialize to a Prometheus-style label string for logging / export.
   * Example: `itemsIn{job="j1",vertex="filter"} 42`
   */
  toPrometheusString(): string {
    if (this.tags.size === 0) {
      return `${this.name} ${this.value}`;
    }

    const labels = [...this.tags.entries()]
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${this.name}{${labels}} ${this.value}`;
  }

  /**
   * Return a new TaggedMetric with the same tags but a different value.
   */
  withValue(newValue: number): TaggedMetric {
    return new TaggedMetric(this.name, newValue, this.tags);
  }

  /**
   * Return a new TaggedMetric with additional tags merged in.
   * Existing tag values are preserved (incoming tags do not overwrite).
   */
  withExtraTags(extraTags: ReadonlyMap<string, string>): TaggedMetric {
    const merged = new Map(extraTags);
    for (const [k, v] of this.tags) {
      merged.set(k, v);
    }
    return new TaggedMetric(this.name, this.value, merged);
  }
}
