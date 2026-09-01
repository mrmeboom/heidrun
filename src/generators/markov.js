// Simplest possible Markov chain — 2 states (on/off), order 1. Not a lesser version
// of "real" Markov logic, it's the cheapest legitimate instance of it (prototype.md §8.4.3).

/**
 * @param {{ stayOnProb?: number, turnOnProb?: number, seed?: number }} config
 * stayOnProb: chance of staying "on" given currently on (default 0.3 / 30%).
 * turnOnProb: chance of turning "on" given currently off (default 0.6 / 60%).
 */
export function createMarkovGenerator(config = {}) {
  const stayOnProb = config.stayOnProb ?? 0.3;
  const turnOnProb = config.turnOnProb ?? 0.6;
  let state = config.seed != null ? (config.seed % 2 === 1) : false;
  let lastIndex = -1;

  return {
    read(index) {
      // Only advance the chain on a genuinely new index — repeated reads of the
      // same index (e.g. re-render) must not silently burn extra steps.
      if (index !== lastIndex) {
        const roll = Math.random();
        state = state ? roll < stayOnProb : roll < turnOnProb;
        lastIndex = index;
      }
      return state;
    },
    reseed(seed) {
      state = seed != null ? seed % 2 === 1 : Math.random() < 0.5;
      lastIndex = -1;
    },
  };
}
