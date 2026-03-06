/**
 * Test fixture: returns whether we are on the main thread.
 * In a worker, Bun.isMainThread should be false.
 */
export default function (_input: unknown): boolean {
    return Bun.isMainThread;
}
