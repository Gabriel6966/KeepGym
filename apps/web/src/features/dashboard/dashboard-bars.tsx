import { normalizeNonNegativeBars } from './visual-scale';

export function DecorativeBar({
  width,
  muted = false,
}: {
  width: number;
  muted?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-visual-bar
      className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
    >
      <div
        className={
          'h-full rounded-full ' + (muted ? 'bg-slate-400' : 'bg-slate-800')
        }
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

// Text is the accessible data. Missing observations do not enter the scale and
// have no numeric bar; they remain the formatter's explicit absence marker.
export function ComparisonBars({
  previous,
  current,
  formatValue,
  previousLabel = 'Previous',
  currentLabel = 'Current',
}: {
  previous: number | null;
  current: number | null;
  formatValue: (value: number | null) => string;
  previousLabel?: string;
  currentLabel?: string;
}) {
  const widths = normalizeNonNegativeBars(
    [previous, current].filter((value): value is number => value !== null),
  );
  const rows = [
    {
      label: previousLabel,
      value: previous,
      width: previous === null ? undefined : widths[0],
      muted: true,
    },
    {
      label: currentLabel,
      value: current,
      width: current === null ? undefined : widths.at(-1),
      muted: false,
    },
  ];
  return (
    <dl className="space-y-4">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2"
        >
          <dt className="min-w-0 text-xs font-medium text-slate-500 [overflow-wrap:anywhere]">
            {row.label}
          </dt>
          <dd className="min-w-0 text-right text-sm font-semibold tabular-nums text-slate-800 [overflow-wrap:anywhere]">
            {formatValue(row.value)}
          </dd>
          {row.width !== undefined && (
            <dd aria-hidden="true" className="col-span-2">
              <DecorativeBar width={row.width} muted={row.muted} />
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
