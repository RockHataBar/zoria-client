export interface ThinkStats {
  p50: string;
  p99: string;
  max: string;
}

export function thinkStats(samples: readonly number[]): ThinkStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p: number): string => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]!.toFixed(1) : '0');
  return { p50: q(50), p99: q(99), max: q(100) };
}
