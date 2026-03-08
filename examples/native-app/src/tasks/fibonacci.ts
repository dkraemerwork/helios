/**
 * CPU-bound Fibonacci task for scatter worker execution.
 *
 * Deliberately uses naive recursive Fibonacci to create real CPU load
 * in the scatter thread pool. The depth parameter controls how much
 * work each task does.
 */

interface FibonacciInput {
  n: number;
  /** Optional label for tracing. */
  label?: string;
}

interface FibonacciResult {
  n: number;
  result: number;
  durationMs: number;
  worker: string;
  label?: string;
}

function fib(n: number): number {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

export default function fibonacci(raw: unknown): FibonacciResult {
  const input = raw as FibonacciInput;
  const start = performance.now();
  const result = fib(input.n);
  return {
    n: input.n,
    result,
    durationMs: performance.now() - start,
    worker: `pid-${process.pid}`,
    label: input.label,
  };
}
