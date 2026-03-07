/**
 * Test fixture: waits before returning a result.
 */
export default async function (input: unknown): Promise<unknown> {
    const spec = typeof input === 'object' && input !== null
        ? input as { delayMs?: number; result?: unknown }
        : { delayMs: Number(input), result: input };

    await Bun.sleep(Number(spec.delayMs ?? 0));
    return spec.result ?? null;
}
