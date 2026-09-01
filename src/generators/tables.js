// Precomputed lookup tables — expanded once, offline (at module load), never recomputed
// per tick. See architecture.md §5 and prototype.md §8.4.

function computePrimeTable(n) {
  const table = new Array(n).fill(false);
  for (let i = 2; i < n; i++) {
    let isPrime = true;
    for (let d = 2; d * d <= i; d++) {
      if (i % d === 0) { isPrime = false; break; }
    }
    table[i] = isPrime;
  }
  return table;
}

/** index i is true iff i is prime. */
export const PRIME_TABLE = computePrimeTable(128);

// Pisano period for mod 6 — the raw Fibonacci-mod-6 sequence, read as gap widths
// ("vi zeros, then a one") rather than as gate values directly (prototype.md §8.4.2).
const FIBONACCI_MOD6_GAPS = [0, 1, 1, 2, 3, 5, 2, 1, 3, 4, 1, 5, 0, 5, 5, 4, 3, 1, 4, 5, 3, 2, 5, 1];

function expandGaps(gaps) {
  const bits = [];
  for (const gap of gaps) {
    for (let i = 0; i < gap; i++) bits.push(false);
    bits.push(true);
  }
  return bits;
}

export const FIBONACCI_GATE_TABLE = expandGaps(FIBONACCI_MOD6_GAPS);
