type DurationValue = string | number;

// Fixed-point arithmetic, independent of Prisma/HTTP. PostgreSQL EPOCH returns
// NUMERIC (often six decimal places); our timestamps have millisecond precision.
function fraction(value: DurationValue): {
  numerator: bigint;
  denominator: bigint;
} {
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text))
    throw new RangeError('Expected non-negative finite duration seconds.');
  const [whole, decimals = ''] = text.split('.');
  const denominator = 10n ** BigInt(decimals.length);
  return {
    numerator: BigInt(whole!) * denominator + BigInt(decimals || '0'),
    denominator,
  };
}
function publicMilliseconds(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Duration exceeds safe public numeric precision.');
  return Number(value) / 1000;
}
function roundedDivision(numerator: bigint, denominator: bigint): bigint {
  return (
    numerator / denominator +
    (2n * (numerator % denominator) >= denominator ? 1n : 0n)
  );
}
export function roundDurationSeconds(value: DurationValue): number {
  const { numerator, denominator } = fraction(value);
  return publicMilliseconds(roundedDivision(numerator * 1000n, denominator));
}
export function calculateAverageDuration(
  totalSeconds: DurationValue,
  count: number,
): number | null {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RangeError('Expected a non-negative safe workout count.');
  const { numerator, denominator } = fraction(totalSeconds);
  return count === 0
    ? null
    : publicMilliseconds(
        roundedDivision(numerator * 1000n, denominator * BigInt(count)),
      );
}
export function sumDurationSeconds(values: readonly string[]): string {
  let milliseconds = 0n;
  for (const value of values) {
    const { numerator, denominator } = fraction(value);
    if ((numerator * 1000n) % denominator !== 0n)
      throw new RangeError(
        'Persisted durations must have millisecond precision.',
      );
    milliseconds += (numerator * 1000n) / denominator;
  }
  return `${milliseconds / 1000n}.${String(milliseconds % 1000n).padStart(3, '0')}`;
}
