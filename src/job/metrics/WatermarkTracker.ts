/**
 * WatermarkTracker — tracks event-time watermark progression for a single vertex.
 *
 * Mirrors Hazelcast Jet's per-vertex watermark semantics:
 *   - topObservedWm:      highest watermark timestamp seen across all input edges
 *   - coalescedWm:        merged (min of latest per-edge) watermark — the "safe" event time
 *   - lastForwardedWm:    most recent watermark forwarded downstream
 *   - lastForwardedWmLatency: wall-clock lag = Date.now() - lastForwardedWm (ms)
 *
 * `observeWatermark` is called once per input edge when a watermark arrives.
 * `forwardWatermark` is called when a watermark is emitted to the outbox.
 */
export class WatermarkTracker {
  /** Per-edge latest watermark. Keyed by edge ordinal (0-based). */
  private readonly edgeWatermarks = new Map<number, number>();
  private readonly edgeCount: number;

  private _topObservedWm = -1;
  private _coalescedWm = -1;
  private _lastForwardedWm = -1;

  constructor(edgeCount: number) {
    this.edgeCount = edgeCount < 1 ? 1 : edgeCount;
  }

  /** Highest watermark timestamp seen from any edge. -1 if none observed. */
  get topObservedWm(): number {
    return this._topObservedWm;
  }

  /**
   * Merged watermark (min of latest per-edge watermarks). -1 until every edge
   * has sent at least one watermark.
   */
  get coalescedWm(): number {
    return this._coalescedWm;
  }

  /** Most recent watermark forwarded downstream. -1 if none forwarded. */
  get lastForwardedWm(): number {
    return this._lastForwardedWm;
  }

  /**
   * Event-time lag in ms: (Date.now() - lastForwardedWm).
   * Returns -1 when no watermark has been forwarded yet.
   */
  get lastForwardedWmLatency(): number {
    if (this._lastForwardedWm < 0) return -1;
    return Date.now() - this._lastForwardedWm;
  }

  /**
   * Record a watermark from the given input edge ordinal.
   * Updates topObservedWm and recomputes coalescedWm.
   *
   * @param timestamp Event-time watermark value (epoch ms)
   * @param edgeOrdinal Zero-based index of the input edge
   */
  observeWatermark(timestamp: number, edgeOrdinal = 0): void {
    const prev = this.edgeWatermarks.get(edgeOrdinal) ?? -1;
    if (timestamp > prev) {
      this.edgeWatermarks.set(edgeOrdinal, timestamp);
    }

    if (timestamp > this._topObservedWm) {
      this._topObservedWm = timestamp;
    }

    this.recomputeCoalesced();
  }

  /**
   * Record that a watermark has been forwarded downstream.
   * Should be called immediately after sending the watermark to the outbox.
   *
   * @param timestamp The forwarded watermark value (epoch ms)
   */
  forwardWatermark(timestamp: number): void {
    if (timestamp > this._lastForwardedWm) {
      this._lastForwardedWm = timestamp;
    }
  }

  /** Reset all state (e.g. after a snapshot restore). */
  reset(): void {
    this.edgeWatermarks.clear();
    this._topObservedWm = -1;
    this._coalescedWm = -1;
    this._lastForwardedWm = -1;
  }

  private recomputeCoalesced(): void {
    if (this.edgeWatermarks.size < this.edgeCount) {
      // Not all edges have reported yet — coalesced remains undefined
      this._coalescedWm = -1;
      return;
    }

    let min = Number.MAX_SAFE_INTEGER;
    for (const wm of this.edgeWatermarks.values()) {
      if (wm < min) min = wm;
    }
    this._coalescedWm = min;
  }
}
