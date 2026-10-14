import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CalendarDays,
  CalendarLoading,
  CalendarMonthControls,
  CalendarViewLink,
  SelectedCalendarDay,
} from '../src/features/history/calendar-content';
import { WorkoutError } from '../src/features/workout/workout.ui';
import { trainingCalendar } from './support/training-calendar-fixture';

void test('calendar renders 28/29/30/31 backend days exactly once, Monday-first headings and layout-only placeholders', () => {
  for (const [month, count, leading] of [
    ['2026-02', 28, 6],
    ['2024-02', 29, 3],
    ['2026-04', 30, 2],
    ['2026-10', 31, 3],
  ] as const) {
    const data = trainingCalendar(month),
      markup = renderToStaticMarkup(
        <CalendarDays
          data={data}
          today="2026-10-14"
          selected={data.fromDate}
          onSelect={() => undefined}
          locale="en-GB"
        />,
      );
    assert.equal((markup.match(/data-calendar-date=/g) ?? []).length, count);
    assert.equal(
      (markup.match(/data-calendar-placeholder=/g) ?? []).length,
      leading + ((7 - ((leading + count) % 7)) % 7),
    );
    for (const day of data.days)
      assert.equal(
        markup.split('data-calendar-date="' + day.date + '"').length,
        2,
      );
    assert.match(markup, /title="Monday"/);
    assert.ok(
      markup.indexOf('title="Monday"') < markup.indexOf('title="Sunday"'),
    );
    assert.match(markup, /aria-pressed="true"/);
    assert.equal(
      (markup.match(/aria-current="date"/g) ?? []).length,
      month === '2026-10' ? 1 : 0,
    );
    assert.match(markup, /2 completed workouts/);
    assert.match(markup, /0 completed workouts/);
  }
});
void test('selected day renders exact backend daily metrics, fractional duration and canonical kg', () => {
  const markup = renderToStaticMarkup(
    <SelectedCalendarDay day={trainingCalendar().days[0]!} locale="en-GB" />,
  );
  for (const text of [
    '1 October 2026',
    'Completed workouts',
    'Completed sets',
    'Total reps',
    'Total volume',
    'Total duration',
    '1,727.25 kg',
    '1h 30m',
    '5,400.125 seconds',
  ])
    assert.ok(markup.includes(text), text);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /<dl/);
  assert.doesNotMatch(markup, /average|streak|monthly/i);
});
void test('zero-set completed day remains active with duration; bodyweight retains reps/sets and zero volume; zero days render facts', () => {
  const data = trainingCalendar();
  for (const index of [1, 2, 4]) {
    const day = data.days[index]!,
      markup = renderToStaticMarkup(
        <SelectedCalendarDay day={day} locale="en-GB" />,
      );
    assert.ok(markup.includes('0 kg'));
    assert.ok(
      markup.includes(
        index === 1
          ? '3,600 seconds'
          : index === 2
            ? '1,800 seconds'
            : '0 seconds',
      ),
    );
    assert.doesNotMatch(markup, /No activity|No workout|missing/i);
  }
  const grid = renderToStaticMarkup(
    <CalendarDays
      data={data}
      today="2030-01-01"
      selected={data.days[1]!.date}
      onSelect={() => undefined}
    />,
  );
  assert.match(
    grid,
    /data-calendar-date="2026-10-02"[^>]*aria-pressed="true"[^>]*bg-slate-800/,
  );
  assert.doesNotMatch(grid, /aria-current="date"/);
});
void test('month navigation remains available for future months and semantic loading/error/History links are readable', () => {
  const markup = renderToStaticMarkup(
    <CalendarMonthControls
      month="2099-02"
      currentMonth="2026-10"
      onMonth={() => undefined}
      locale="en-GB"
    />,
  );
  for (const label of [
    'February 2099',
    'Previous month',
    'Next month',
    'Current month',
  ])
    assert.ok(markup.includes(label));
  assert.doesNotMatch(markup, / disabled="/);
  assert.match(
    renderToStaticMarkup(<CalendarLoading />),
    /role="status" aria-busy="true"/,
  );
  assert.doesNotMatch(
    renderToStaticMarkup(<CalendarLoading />),
    /data-calendar-date=/,
  );
  const error = renderToStaticMarkup(
    <WorkoutError
      title="Training calendar unavailable"
      onRetry={() => undefined}
    />,
  );
  assert.match(error, /role="alert"/);
  assert.match(error, /Retry/);
  assert.doesNotMatch(error, /0 workouts/);
  assert.match(
    renderToStaticMarkup(<CalendarViewLink />),
    /href="\/history\/calendar"[^>]*>Calendar view/,
  );
});
