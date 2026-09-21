// Calendar dates use UTC only as a lossless bridge to Prisma's DateTime API.
export function isValidBirthDate(
  value: unknown,
  now = new Date(),
): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-')
  )
    return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value <= now.toISOString().slice(0, 10)
  );
}
