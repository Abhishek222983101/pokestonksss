/** Rolling latency tracker for the UI chips (measured, never faked). */
export class Latency {
  private xs: number[] = [];
  private subs = new Set<() => void>();
  constructor(private cap = 50) {}
  add(ms: number) { this.xs.push(ms); if (this.xs.length > this.cap) this.xs.shift(); this.subs.forEach((f) => f()); }
  subscribe(f: () => void) { this.subs.add(f); return () => this.subs.delete(f); }
  get count() { return this.xs.length; }
  private pct(p: number) { if (!this.xs.length) return 0; const s = [...this.xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }
  get p50() { return this.pct(0.5); }
  get p95() { return this.pct(0.95); }
  get last() { return this.xs.length ? this.xs[this.xs.length - 1] : 0; }
}
