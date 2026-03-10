/**
 * Matrix multiplication task for scatter worker execution.
 *
 * Multiplies two NxN matrices to create sustained CPU + memory load.
 */

interface MatrixInput {
  size: number;
  seed: number;
  label?: string;
}

interface MatrixResult {
  size: number;
  trace: number;
  durationMs: number;
  worker: string;
  label?: string;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function createMatrix(size: number, rng: () => number): Float64Array {
  const matrix = new Float64Array(size * size);
  for (let i = 0; i < matrix.length; i++) {
    matrix[i] = rng() * 100 - 50;
  }
  return matrix;
}

function multiply(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const result = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = a[i * n + k]!;
      for (let j = 0; j < n; j++) {
        result[i * n + j]! += aik * b[k * n + j]!;
      }
    }
  }
  return result;
}

export default function matrixMultiply(raw: unknown): MatrixResult {
  const input = raw as MatrixInput;
  const start = performance.now();
  const rng = seededRandom(input.seed);

  const a = createMatrix(input.size, rng);
  const b = createMatrix(input.size, rng);
  const result = multiply(a, b, input.size);

  let trace = 0;
  for (let i = 0; i < input.size; i++) {
    trace += result[i * input.size + i]!;
  }

  return {
    size: input.size,
    trace,
    durationMs: performance.now() - start,
    worker: `pid-${process.pid}`,
    label: input.label,
  };
}
