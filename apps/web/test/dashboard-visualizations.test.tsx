import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComparisonBars } from '../src/features/dashboard/dashboard-bars';
import {
  WeeklyComparisonVisualization,
  MuscleGroupVisualization,
  BodyProgressVisualization,
} from '../src/features/dashboard/dashboard-visualizations';
import {
  emptyDashboard,
  populatedDashboard,
} from './support/dashboard-fixture';
import { formatNumber } from '../src/features/dashboard/format';
import type { DashboardSummary } from '../src/features/dashboard/dashboard.types';

function article(html: string, attribute: string, key: string) {
  const item = html.match(
    new RegExp(
      '<(?:article|li)[^>]*' +
        attribute +
        '="' +
        key +
        '"[^>]*>(.*?)</(?:article|li)>',
      's',
    ),
  );
  assert.ok(item, 'Missing ' + key);
  return item[1]!;
}
const weekly = (data: DashboardSummary) =>
  renderToStaticMarkup(
    <WeeklyComparisonVisualization
      week={data.week}
      comparison={data.comparison}
      locale="en-US"
    />,
  );
const body = (data: DashboardSummary) =>
  renderToStaticMarkup(
    <BodyProgressVisualization
      progress={data.bodyProgress}
      timezone={data.timezone}
      locale="en-US"
    />,
  );
const widths = (html: string) =>
  [...html.matchAll(/style="width:([\d.e+-]+)%"/g)].map((match) =>
    Number(match[1]),
  );
for (const [previous, current, expected] of [
  [3, 5, [60, 100]],
  [5, 3, [100, 60]],
  [5, 5, [100, 100]],
  [0, 0, [0, 0]],
  [0, 5, [0, 100]],
  [5, 0, [100, 0]],
] as const)
  void test(`weekly Previous ${previous} / Current ${current} has separate safe bars and exact visible values`, () => {
    const data = emptyDashboard();
    data.week.completedWorkouts = current;
    data.comparison.completedWorkouts = {
      previous,
      delta: -99,
      percentageChange: null,
    };
    const card = article(
      weekly(data),
      'data-comparison-metric',
      'completedWorkouts',
    );
    assert.deepEqual(widths(card), [...expected]);
    assert.match(
      card,
      new RegExp('>Previous</dt><dd[^>]*>' + previous + '</dd>'),
    );
    assert.match(
      card,
      new RegExp('>Current</dt><dd[^>]*>' + current + '</dd>'),
    );
    assert.match(card, />Change<\/dt><dd[^>]*>-99/);
    assert.match(card, />% change<\/dt><dd[^>]*>—/);
    assert.doesNotMatch(card, /NaN|Infinity|Plateau|No progress/);
  });
void test('weekly each unit has its own scale and backend signed deltas/percentages are not recalculated', () => {
  const data = populatedDashboard();
  data.comparison.totalVolumeKg = {
    previous: 4240.25,
    delta: -123.45,
    percentageChange: -66.77,
  };
  data.comparison.completedWorkouts.percentageChange = 17.89;
  const html = weekly(data),
    volume = article(html, 'data-comparison-metric', 'totalVolumeKg');
  assert.match(volume, /4,240\.25 kg/);
  assert.match(volume, /1,855\.75 kg/);
  assert.match(volume, /-123\.45 kg/);
  assert.match(volume, /-66\.77%/);
  assert.match(html, /\+17\.89%/);
  assert.equal(
    widths(article(html, 'data-comparison-metric', 'completedWorkouts')).at(-1),
    100,
  );
  assert.equal(widths(volume)[0], 100);
});
void test('weekly normal fixture preserves four metric headings, counts and kg through existing formatter', () => {
  const html = weekly(populatedDashboard());
  for (const label of [
    'Workouts',
    'Sets',
    'Reps',
    'Volume (kg)',
    '1,500 kg',
    '1,855.75 kg',
    '+355.75 kg',
    '+23.72%',
  ])
    assert.ok(html.includes(label), label);
  assert.equal((html.match(/<h3/g) ?? []).length, 4);
  assert.equal((html.match(/data-visual-bar="true"/g) ?? []).length, 8);
});
void test('muscle empty state has no chart, no fabricated zero groups', () => {
  const html = renderToStaticMarkup(
    <MuscleGroupVisualization groups={[]} locale="en-US" />,
  );
  assert.match(html, /No muscle-group activity this week/);
  assert.doesNotMatch(html, /data-visual-bar|<svg|<canvas|Chest|Back/);
});
void test('one active group keeps workouts/sets/reps/volume, bars visualize only completedSets', () => {
  const html = renderToStaticMarkup(
    <MuscleGroupVisualization
      groups={[
        {
          muscleGroup: 'CHEST',
          completedWorkouts: 2,
          completedSets: 5,
          totalReps: 40,
          totalVolumeKg: 3080,
        },
      ]}
      locale="en-US"
    />,
  );
  assert.deepEqual(widths(html), [100]);
  for (const [label, value] of [
    ['Workouts', '2'],
    ['Sets', '5'],
    ['Reps', '40'],
    ['Volume', '3,080 kg'],
  ])
    assert.match(
      html,
      new RegExp('>' + label + '</dt><dd[^>]*>' + value + '</dd>'),
    );
  assert.doesNotMatch(html, /Triceps|Shoulders|secondaryMuscles|percent|rank/i);
});
void test('muscle cards preserve delivered order, never volume ranking; bodyweight is active with zero kg', () => {
  const data = populatedDashboard();
  data.muscleGroups.reverse();
  const before = structuredClone(data.muscleGroups),
    html = renderToStaticMarkup(
      <MuscleGroupVisualization groups={data.muscleGroups} locale="en-US" />,
    );
  assert.deepEqual(
    [...html.matchAll(/data-muscle-group="([^"]+)"/g)].map((match) => match[1]),
    ['TRICEPS', 'CHEST', 'BACK'],
  );
  assert.deepEqual(widths(html), [40, 100, 40]);
  const back = article(html, 'data-muscle-group', 'BACK');
  assert.match(back, />Volume<\/dt><dd[^>]*>0 kg/);
  assert.match(back, />Sets<\/dt><dd[^>]*>2/);
  assert.match(back, />Reps<\/dt><dd[^>]*>16/);
  assert.deepEqual(data.muscleGroups, before);
});
void test('body previous/latest/change preserve independent timestamps and exact backend change rather than deriving it', () => {
  const data = populatedDashboard();
  data.bodyProgress.weightKg.change = -7.77;
  const card = article(body(data), 'data-body-metric', 'weightKg');
  assert.match(card, />Previous<\/dt><dd[^>]*>80\.5 kg/);
  assert.match(card, />Latest<\/dt><dd[^>]*>79\.25 kg/);
  assert.match(card, />Change<\/dt><dd[^>]*>-7\.77 kg/);
  assert.match(card, /2026-09-20T06:00:00Z/);
  assert.match(card, /2026-09-01T06:00:00Z/);
  assert.equal(widths(card)[0], 100);
  assert.ok(widths(card)[1]! < 100);
});
void test('body latest-only keeps previous/change absent and has only one real numeric bar', () => {
  const card = article(
    body(populatedDashboard()),
    'data-body-metric',
    'waistCm',
  );
  assert.match(card, />Previous<\/dt><dd[^>]*>—/);
  assert.match(card, />Latest<\/dt><dd[^>]*>85 cm/);
  assert.match(card, />Change<\/dt><dd[^>]*>—/);
  assert.deepEqual(widths(card), [100]);
  assert.doesNotMatch(card, /0 cm|Previous measured/);
});
void test('body empty metrics have explicit absence, no numeric bar or invented values', () => {
  const html = body(emptyDashboard());
  assert.equal((html.match(/No observations/g) ?? []).length, 5);
  assert.equal((html.match(/>—</g) ?? []).length, 15);
  assert.deepEqual(widths(html), []);
  assert.doesNotMatch(html, /0 kg|0%|0 cm|NaN|Infinity/);
});
for (const change of [-1.25, 1.25, 0])
  void test('body weight signed backend change is neutral ' + change, () => {
    const data = populatedDashboard();
    data.bodyProgress.weightKg.change = change;
    const card = article(body(data), 'data-body-metric', 'weightKg');
    assert.match(
      card,
      new RegExp(
        '>Change</dt><dd[^>]*>' +
          String(change > 0 ? '\\+' + change : change).replace('.', '\\.') +
          ' kg',
      ),
    );
    assert.doesNotMatch(
      card,
      /\b(?:Improved|Worse|Good|Bad|On track|green|red|success|failure)\b/i,
    );
  });
void test('body fat uses % and pp; chest/hips use cm, with independent scales and no UnitSystem conversion', () => {
  const data = populatedDashboard();
  for (const [key, latest, previous, change] of [
    ['bodyFatPercent', 19.5, 20, -0.5],
    ['chestCm', 99.5, 100, -0.5],
    ['hipsCm', 98, 99, -1],
  ] as const)
    data.bodyProgress[key] = {
      latest: { value: latest, measuredAt: '2026-09-10T06:00:00Z' },
      previous: { value: previous, measuredAt: '2026-09-01T06:00:00Z' },
      change,
    };
  const html = body(data);
  assert.match(article(html, 'data-body-metric', 'bodyFatPercent'), /19\.5%/);
  assert.match(article(html, 'data-body-metric', 'bodyFatPercent'), /-0\.5 pp/);
  assert.match(article(html, 'data-body-metric', 'chestCm'), /99\.5 cm/);
  assert.match(article(html, 'data-body-metric', 'hipsCm'), /98 cm/);
  assert.doesNotMatch(html, /\blb\b|inches|BMI|percentageChange/);
});
void test('real zero remains zero rather than absence in presentation', () => {
  const data = emptyDashboard();
  data.bodyProgress.weightKg = {
    latest: { value: 0, measuredAt: '2026-09-01T00:00:00Z' },
    previous: null,
    change: null,
  };
  const card = article(body(data), 'data-body-metric', 'weightKg');
  assert.match(card, />Latest<\/dt><dd[^>]*>0 kg/);
  assert.deepEqual(widths(card), [0]);
});
void test('decorative chart has no duplicated numeric accessible image label, long labels are not truncated', () => {
  const html = renderToStaticMarkup(
    <ComparisonBars
      previous={0}
      current={5}
      previousLabel="Previous observation with a deliberately long translated label"
      currentLabel="Latest observation with another long label"
      formatValue={(value) => formatNumber(value, 'en-US')}
    />,
  );
  assert.match(html, /aria-hidden="true" data-visual-bar/);
  assert.doesNotMatch(html, /role="img"|aria-label=".*5|<svg|<canvas|truncate/);
  assert.match(html, /deliberately long translated label/);
  assert.match(html, /overflow-wrap:anywhere/);
});
void test('visualizations are deterministic SSR and never mutate the supplied read model', () => {
  const data = populatedDashboard(),
    before = structuredClone(data);
  assert.equal(weekly(data) + body(data), weekly(data) + body(data));
  assert.deepEqual(data, before);
});
