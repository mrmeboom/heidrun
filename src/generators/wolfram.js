// Elementary cellular automaton (rule 30/90/110/150 etc.), row held in a 32-bit
// integer, one bit per cell, edges wrapped circularly. Cheap: a fixed 32-iteration
// step regardless of what's asked of it — see prototype.md §8.4.5.

const WIDTH = 32;

export function createWolframGenerator(config = {}) {
  const ruleBits = (config.rule ?? 30) & 0xff;
  let row = (config.seed ?? 1) >>> 0;
  if (row === 0) row = 1; // an all-zero row never changes under any rule
  let lastIndex = -1;
  let outBit = 0;

  function applyRule(left, center, right) {
    const pattern = (left << 2) | (center << 1) | right;
    return (ruleBits >> pattern) & 1;
  }

  function step() {
    let next = 0;
    for (let i = 0; i < WIDTH; i++) {
      const left = (row >>> ((i + 1) % WIDTH)) & 1;
      const center = (row >>> i) & 1;
      const right = (row >>> ((i - 1 + WIDTH) % WIDTH)) & 1;
      next |= applyRule(left, center, right) << i;
    }
    row = next >>> 0;
    return row & 1;
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
      row = (seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
      if (row === 0) row = 1;
      lastIndex = -1;
    },
  };
}
