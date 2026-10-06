import type { PublicMetricComparison } from './training-trends.types';

type ComparisonValue = number | string;

// Counts are integers and NUMERIC volume has at most two decimal places.
// Fixed-point integers preserve exact subtraction/division until presentation,
// without a Prisma dependency or changing the shared Epley implementation.
function hundredths(value: ComparisonValue): bigint {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text))
    throw new RangeError(
      'Comparison requires non-negative fixed-point metrics.',
    );
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function publicNumber(value: bigint): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new RangeError('Comparison exceeds safe numeric precision.');
  return Number(value) / 100;
}

export function calculateDelta(
  previous: ComparisonValue,
  current: ComparisonValue,
): number {
  return publicNumber(hundredths(current) - hundredths(previous));
}

export function calculatePercentageChange(
  previous: ComparisonValue,
  current: ComparisonValue,
): number | null {
  const baseline = hundredths(previous);
  const difference = hundredths(current) - baseline;
  if (baseline === 0n) return null;
  const numerator = (difference < 0n ? -difference : difference) * 10000n;
  // Round half away from zero, matching the existing public ROUND_HALF_UP policy.
  const rounded =
    numerator / baseline + (2n * (numerator % baseline) >= baseline ? 1n : 0n);
  return publicNumber(difference < 0n ? -rounded : rounded);
}

export function compareMetric(
  previous: ComparisonValue,
  current: ComparisonValue,
): PublicMetricComparison {
  return {
    delta: calculateDelta(previous, current),
    percentageChange: calculatePercentageChange(previous, current),
  };
}
