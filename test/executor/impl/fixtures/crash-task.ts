/**
 * Test fixture: always throws to simulate a worker crash.
 */
export default function (_input: unknown): never {
    throw new Error('Intentional crash for testing');
}
