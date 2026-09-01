// 16-bit Fibonacci LFSR, taps at bits 16,15,13,4 (a maximal-length polynomial) —
// classic cheap pseudo-random bit stream, the trick chiptune hardware used for
// noise/hats (prototype.md §8.4.4).

const DEFAULT_SEED = 0xace1;

export function createLfsrGenerator(config = {}) {
  let state = (config.seed ?? DEFAULT_SEED) & 0xffff;
  if (state === 0) state = DEFAULT_SEED; // all-zero state never changes
  let lastIndex = -1;
  let outBit = 0;

  function step() {
    const bit = ((state >> 15) ^ (state >> 14) ^ (state >> 12) ^ (state >> 3)) & 1;
    state = ((state << 1) | bit) & 0xffff;
    return bit;
  }

  return {
    read(index) {
      if (index !== lastIndex) {
        outBit = step();
        lastIndex = index;
      }
      return outBit === 1;
    },
    reseed(seed) {
      state = (seed ?? Math.floor(Math.random() * 0xffff)) & 0xffff;
      if (state === 0) state = DEFAULT_SEED;
      lastIndex = -1;
    },
  };
}
