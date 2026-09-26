import { Prisma } from '../generated/prisma/client';

// Reuse the existing decimal arithmetic implementation, without a DB client.
// A private constructor avoids changing Prisma's global Decimal configuration.
const MetricDecimal = Prisma.Decimal.clone({ precision: 40 });
export type MetricValue = number | string | Prisma.Decimal;
export const MAX_ESTIMATED_1RM_REPS = 20;

export function roundMetric(value: MetricValue): number {
  const rounded = new MetricDecimal(value).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  if (!rounded.isFinite() || rounded.abs().mul(100).gt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Metric exceeds safe numeric precision.');
  return rounded.toNumber();
}

export function calculateSetVolume(loadKg: MetricValue, reps: number): number {
  return roundMetric(new MetricDecimal(loadKg).mul(reps));
}

export function sumSetVolumes(
  sets: readonly { loadKg: MetricValue; reps: number }[],
): number {
  return roundMetric(
    sets.reduce(
      (total, set) => total.plus(new MetricDecimal(set.loadKg).mul(set.reps)),
      new MetricDecimal(0),
    ),
  );
}

// Compare this numerator before rounding. The denominator (30) is constant for
// every eligible set, so this preserves exact Epley ranking, including ties.
export function estimated1RMScore(
  loadKg: MetricValue,
  reps: number,
): Prisma.Decimal | null {
  const load = new MetricDecimal(loadKg);
  return load.isFinite() &&
    load.gt(0) &&
    Number.isInteger(reps) &&
    reps >= 1 &&
    reps <= MAX_ESTIMATED_1RM_REPS
    ? load.mul(30 + reps)
    : null;
}

export function calculateEstimated1RM(
  loadKg: MetricValue,
  reps: number,
): number | null {
  const score = estimated1RMScore(loadKg, reps);
  return score === null ? null : roundMetric(score.div(30));
}
