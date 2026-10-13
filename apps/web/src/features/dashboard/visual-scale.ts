// Presentation widths only: never percentages, totals, changes or targets.
export function normalizeNonNegativeBars(values: readonly number[]): number[] {
  let maximum = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError('Visual scale requires finite non-negative values.');
    maximum = Math.max(maximum, value);
  }
  // Divide before multiplying so large, finite values cannot overflow.
  return values.map((value) =>
    maximum === 0 || value === 0
      ? 0
      : Math.min(100, Math.max(0, (value / maximum) * 100)),
  );
}
