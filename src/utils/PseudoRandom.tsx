/**
 * Returns a deterministic pseudo-random unsigned 32-bit integer for a given seed.
 * Same seed always produces the same output. If seed is null, a random seed
 * between 0 and 100,000,000 is generated.
 *
 * Implemented using xxHash32 — a non-cryptographic hash that provides excellent
 * "avalanche": flipping any single input bit flips ~50% of output bits, giving
 * a uniform distribution across the output range. Only uses multiply, XOR, and
 * bit-rotation.
 *
 * The five Px constants are odd primes with no obvious bit patterns; they
 * interact with 32-bit overflow to scatter bits chaotically. P1 is unused here
 * because it only appears in the main stripe loop for inputs >= 16 bytes.
 */
export function pseudoRandom(seed: number | null): [number, number] {
  if (seed === null) seed = Math.floor(Math.random() * 100000000);

  const P2 = 0x85EBCA77;
  const P3 = 0xC2B2AE3D;
  const P4 = 0x27D4EB2F;
  const P5 = 0x165667B1;

  // xxHash32 initialisation for inputs < 16 bytes skips the main stripe loop.
  // Accumulator starts at: hashSeed(0) + P5 + inputLength(4 bytes).
  // >>> 0 reinterprets the result as an unsigned 32-bit integer — necessary
  // because JS bitwise ops work on signed 32-bit ints, which would otherwise
  // produce negative values that corrupt later arithmetic.
  let h = (P5 + 4) >>> 0;

  // Consume the single 32-bit lane (the seed):
  //   1. seed >>> 0       — treat seed as unsigned 32-bit
  //   2. imul(seed, P3)   — 32-bit multiply (Math.imul discards the upper 32
  //                         bits that float * float would corrupt)
  //   3. h + ...          — fold the scaled lane into the accumulator
  //   4. rotl32(..., 17)  — rotate left 17 bits (no bits lost, just repositioned)
  //   5. imul(..., P4)    — multiply by P4 to scatter bits further
  h = Math.imul(rotl32(h + Math.imul(seed >>> 0, P3), 17), P4);

  // Avalanche finalizer — three XOR-shift-multiply rounds specified by xxHash32.
  // Each round: XOR with a right-shifted copy (high bits bleed into low bits),
  // then multiply by a prime (carry propagation spreads every bit further).
  // After three rounds any remaining bit correlations from the input are destroyed.
  // The shift amounts (15, 13, 16) were chosen empirically via SMHasher testing.
  h ^= h >>> 15;
  h = Math.imul(h, P2);
  h ^= h >>> 13;
  h = Math.imul(h, P3);
  h ^= h >>> 16;

  // Cast to unsigned 32-bit integer (0–4,294,967,295).
  return [h >>> 0, seed];
}

/** Rotates x left by r bits within a 32-bit integer.
 *  Unlike a shift, rotation loses no bits — they wrap around to the right side. */
function rotl32(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}
