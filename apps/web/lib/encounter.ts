/** Deterministic grass encounters: a pure function of (routeSeed, stepIndex). P7 feeds routeSeed from the VRF. */
export const ENCOUNTER_THRESHOLD = 28; // out of 256

function mix32(a: number): number {
  let h = a | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function stepHash(routeSeed: number, step: number): number {
  return mix32(mix32(routeSeed ^ 0x9e3779b9) + Math.imul(step, 0x27d4eb2f));
}

export function isEncounter(routeSeed: number, step: number): boolean {
  return (stepHash(routeSeed, step) & 255) < ENCOUNTER_THRESHOLD;
}

/** Which of `n` opponents shows up at this step (uses different hash bits than the encounter roll). */
export function foeIndex(routeSeed: number, step: number, n: number): number {
  return ((stepHash(routeSeed, step) >>> 8) & 0xffff) % n;
}

export function newRouteSeed(): number {
  const a = new Uint32Array(1);
  if (typeof crypto !== 'undefined') crypto.getRandomValues(a); else a[0] = Math.floor(Math.random() * 2 ** 32);
  return a[0];
}
