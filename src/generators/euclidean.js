// Euclidean rhythm (Bjorklund's algorithm) — distributes `hits` pulses as evenly
// as possible across `steps` slots, plus a rotation for phase offset. Computed
// once per parameter change, then a pure lookup.

export function bjorklund(hits, steps) {
  if (steps <= 0) return [];
  if (hits <= 0) return new Array(steps).fill(false);
  if (hits >= steps) return new Array(steps).fill(true);

  const counts = [];
  const remainders = [hits];
  let divisor = steps - hits;
  let level = 0;
  while (remainders[level] > 1) {
    counts.push(Math.floor(divisor / remainders[level]));
    remainders.push(divisor % remainders[level]);
    divisor = remainders[level];
    level++;
  }
  counts.push(divisor);

  const pattern = [];
  function build(lvl) {
    if (lvl === -1) pattern.push(false);
    else if (lvl === -2) pattern.push(true);
    else {
      for (let i = 0; i < counts[lvl]; i++) build(lvl - 1);
      if (remainders[lvl] !== 0) build(lvl - 2);
    }
  }
  build(level);

  const firstHit = pattern.indexOf(true);
  if (firstHit <= 0) return pattern;
  return [...pattern.slice(firstHit), ...pattern.slice(0, firstHit)];
}

function rotate(pattern, rotation) {
  const len = pattern.length;
  if (len === 0) return pattern;
  const r = ((rotation % len) + len) % len;
  return [...pattern.slice(r), ...pattern.slice(0, r)];
}

export function createEuclideanGenerator(config = {}) {
  let hits = config.hits ?? 3;
  let steps = config.steps ?? 8;
  let rotation = config.rotation ?? 0;
  let pattern = rotate(bjorklund(hits, steps), rotation);

  return {
    read(index) {
      if (pattern.length === 0) return false;
      return pattern[((index % pattern.length) + pattern.length) % pattern.length];
    },
    reseed() {
      // Deterministic given (hits, steps, rotation) — nothing to reseed.
    },
    setParams(newHits, newSteps, newRotation = rotation) {
      hits = newHits;
      steps = newSteps;
      rotation = newRotation;
      pattern = rotate(bjorklund(hits, steps), rotation);
    },
  };
}
