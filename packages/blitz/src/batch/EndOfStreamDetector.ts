/**
 * EndOfStreamDetector — signals end-of-stream for bounded pipeline sources.
 *
 * Supports two detection strategies (choose one per instance):
 *
 * - **Count-based** (`expectedCount`): resolves when `onAck()` has been called
 *   exactly `expectedCount` times.  Use when the total record count is known
 *   in advance (e.g. JetStream stream with a known message count).
 *
 * - **Idle-timeout** (`idleTimeoutMs`): resolves when `onMessage()` has not been
 *   called for `idleTimeoutMs` milliseconds.  The timer starts as soon as
 *   `detect()` is called, and is reset on every subsequent `onMessage()` call.
 *   Use for JetStream `deliverAll` consumers where the total count is unknown.
 *
 * For `FileSource` and `HeliosMapSource`, end-of-stream is signalled by the
 * source's async iterator exhausting naturally — no detector is needed.
 *
 * @example Count-based
 * ```typescript
 * const eos = new EndOfStreamDetector({ expectedCount: 1000 });
 * for await (const msg of source.messages()) {
 *   // ... process ...
 *   msg.ack();
 *   eos.onAck();
 * }
 * // or: await eos.detect() to wait externally
 * ```
 *
 * @example Idle-timeout
 * ```typescript
 * const eos = new EndOfStreamDetector({ idleTimeoutMs: 500 });
 * const doneP = eos.detect();
 * for await (const msg of source.messages()) {
 *   eos.onMessage();
 *   // ... process ...
 * }
 * await doneP; // or: cancelled by external timeout
 * ```
 */

export interface EndOfStreamDetectorOptions {
  /** Resolve after this many acks (count-based mode). Mutually exclusive with `idleTimeoutMs`. */
  expectedCount?: number;
  /**
   * Resolve after this many milliseconds with no new messages (idle-timeout mode).
   * Defaults to 100 ms when neither `expectedCount` nor an explicit value is provided.
   */
  idleTimeoutMs?: number;
}

export class EndOfStreamDetector {
  private readonly _expectedCount: number | undefined;
  private readonly _idleTimeoutMs: number;

  private _ackedCount = 0;
  private _detected = false;
  private _resolve?: () => void;
  private _promise?: Promise<void>;
  private _idleTimer?: ReturnType<typeof setTimeout>;

  constructor(options: EndOfStreamDetectorOptions = {}) {
    this._expectedCount = options.expectedCount;
    this._idleTimeoutMs = options.idleTimeoutMs ?? 100;
  }

  /**
   * Call when a new message arrives from the source.
   * Resets the idle timer in idle-timeout mode.
   */
  onMessage(): void {
    if (this._detected) return;
    if (this._expectedCount === undefined) {
      // Idle-timeout mode — any incoming message resets the inactivity clock.
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => {
        this._detected = true;
        this._resolve?.();
      }, this._idleTimeoutMs);
    }
  }

  /**
   * Call when a message has been successfully acknowledged.
   * In count-based mode, increments the ack counter and resolves when the
   * expected count is reached.
   */
  onAck(): void {
    if (this._detected) return;
    this._ackedCount++;
    if (this._expectedCount !== undefined && this._ackedCount >= this._expectedCount) {
      this._detected = true;
      clearTimeout(this._idleTimer);
      this._resolve?.();
    }
  }

  /**
   * Returns a `Promise<void>` that resolves when end-of-stream is detected.
   *
   * - Count-based: resolves after `expectedCount` calls to `onAck()`.
   * - Idle-timeout: resolves after `idleTimeoutMs` with no `onMessage()` calls.
   *
   * If already detected (e.g. after re-use), resolves immediately.
   * The same promise is returned on repeated calls (idempotent).
   */
  detect(): Promise<void> {
    if (this._detected) return Promise.resolve();
    if (!this._promise) {
      this._promise = new Promise<void>(resolve => {
        this._resolve = resolve;
        if (this._expectedCount === undefined) {
          // Idle-timeout mode: start the timer immediately.
          // Clear any timer started by an earlier onMessage() call before detect().
          clearTimeout(this._idleTimer);
          this._idleTimer = setTimeout(() => {
            this._detected = true;
            resolve();
          }, this._idleTimeoutMs);
        }
      });
    }
    return this._promise;
  }

  /**
   * Reset all state so the detector can be reused from scratch.
   * Clears any pending timers and resets the ack count.
   */
  reset(): void {
    clearTimeout(this._idleTimer);
    this._ackedCount = 0;
    this._detected = false;
    this._resolve = undefined;
    this._promise = undefined;
    this._idleTimer = undefined;
  }
}
