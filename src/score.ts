/** Keep confidence in a stable band and round to two decimals. */
export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.55;
  const clamped = Math.min(0.95, Math.max(0.35, value));
  return Math.round(clamped * 100) / 100;
}
