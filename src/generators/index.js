// Uniform generator interface — architecture.md §5. Any object can hold one of
// these; nothing downstream needs to know which type it is, or which index space
// (clock-tick for spawn modules, hit-count for sound modules — prototype.md §8.6)
// is feeding it.
import { PRIME_TABLE, FIBONACCI_GATE_TABLE } from './tables.js';
import { createMarkovGenerator } from './markov.js';
import { createLfsrGenerator } from './lfsr.js';
import { createWolframGenerator } from './wolfram.js';
import { createEuclideanGenerator } from './euclidean.js';

export const GENERATOR_TYPES = ['prime', 'fibonacci', 'markov', 'lfsr', 'wolfram', 'euclidean'];

function createTableGenerator(table) {
  return {
    read(index) {
      const len = table.length;
      return table[((index % len) + len) % len];
    },
    reseed() {
      // Table-backed: the pattern is fixed by definition, nothing to reseed.
    },
  };
}

/**
 * @param {'prime'|'fibonacci'|'markov'|'lfsr'|'wolfram'|'euclidean'} type
 * @param {Object} [config]
 * @returns {{ read(index:number): boolean, reseed?(seed?:number): void }}
 */
export function createGenerator(type, config = {}) {
  switch (type) {
    case 'prime': return createTableGenerator(PRIME_TABLE);
    case 'fibonacci': return createTableGenerator(FIBONACCI_GATE_TABLE);
    case 'markov': return createMarkovGenerator(config);
    case 'lfsr': return createLfsrGenerator(config);
    case 'wolfram': return createWolframGenerator(config);
    case 'euclidean': return createEuclideanGenerator(config);
    default: throw new Error(`Unknown generator type: ${type}`);
  }
}
