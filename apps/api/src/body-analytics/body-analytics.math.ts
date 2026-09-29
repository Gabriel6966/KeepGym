export type BodyMetricValue = number | string | { toString(): string };

// Plain decimal text, including Decimal-like inputs, without Prisma or a DB
// dependency. Half-way rounding is away from zero (same as ROUND_HALF_UP).
function hundredths(value: BodyMetricValue): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.toString());
  if (!match) throw new RangeError('Metric must be a finite plain decimal.');
  const fraction = match[3] ?? '';
  let scaled =
    BigInt(match[2]!) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  if (Number(fraction[2] ?? '0') >= 5) scaled += 1n;
  return match[1] === '-' ? -scaled : scaled;
}
function publicNumber(value: bigint): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new RangeError('Metric exceeds safe numeric precision.');
  return Number(value) / 100;
}
export function roundMetric(value: BodyMetricValue): number {
  return publicNumber(hundredths(value));
}
// BodyMeasurement persists at two decimal places. Subtract integer hundredths,
// rather than binary floats, to preserve exact positive/negative differences.
export function calculateChange(
  latest: BodyMetricValue,
  previous: BodyMetricValue,
): number {
  return publicNumber(hundredths(latest) - hundredths(previous));
}
