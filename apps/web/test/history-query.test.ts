import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authReturnPath } from '../src/features/auth/return-path';
import {
  historyTimestamp,
  normalizeHistoryUrl,
  historyUrl,
  filterDraft,
  validateHistoryFilters,
  hasHistoryFilters,
  validHistoryPagination,
} from '../src/features/history/history-query';
import {
  isHistoryPage,
  isHistoryDetail,
} from '../src/features/history/history.contract';
import { historyDetail, historyPage } from './support/history-fixture';

for (const value of [
  '2026-10-12T00:00:00Z',
  '2026-10-12t00:00:00z',
  '2024-02-29T23:59:59.123-05:00',
  '2026-10-25T02:30:00+02:00',
  '2026-10-25T02:30:00+01:00',
])
  void test(
    'History timestamp matches explicit-offset backend semantics: ' + value,
    () => assert.ok(historyTimestamp(value)),
  );
for (const value of [
  '2026-02-30T00:00:00Z',
  '2026-02-29T00:00:00Z',
  '2026-10-12',
  '2026-10-12T00:00:00',
  '2026-10-12T24:00:00Z',
  '2026-10-12T00:00:60Z',
  '2026-10-12T00:00:00.1234Z',
  '2026-10-12T00:00:00+24:00',
  '0000-01-01T00:00:00Z',
  '0001-01-01T00:00:00+01:00',
])
  void test('History rejects incompatible temporal input: ' + value, () =>
    assert.equal(historyTimestamp(value), null),
  );
void test('URL initial/page refresh/back state round trips only supported filters, preserving zoned instants', () => {
  const input = new URLSearchParams({
    page: '2',
    status: 'CANCELLED',
    q: ' Push ',
    from: '2026-10-12T00:00:00+02:00',
    to: '2026-10-15T00:00:00Z',
  });
  const query = normalizeHistoryUrl(input),
    url = historyUrl(query);
  assert.equal(query.page, 2);
  assert.equal(query.q, 'Push');
  assert.equal(query.status, 'CANCELLED');
  assert.deepEqual(
    normalizeHistoryUrl(new URLSearchParams(url.split('?')[1])),
    query,
  );
  assert.equal(authReturnPath(url), url);
  assert.equal(hasHistoryFilters(query), true);
});
void test('unsafe/duplicate/unknown URL fields normalize safely without sending selectors to backend', () => {
  const query = normalizeHistoryUrl(
    new URLSearchParams(
      'page=01&status=IN_PROGRESS&q=a&q=b&from=2026-02-30&to=abc&userId=private&exercise=x&limit=100',
    ),
  );
  assert.equal(historyUrl(query), '/history');
  assert.equal(query.limit, 20);
  assert.equal(hasHistoryFilters(query), false);
  for (const page of ['0', '-1', '1.5', '1e2', '2147483648'])
    assert.equal(normalizeHistoryUrl(new URLSearchParams({ page })).page, 1);
});
void test('changing search/status/date filters resets page one; empty fields are omitted', () => {
  const draft = filterDraft({ page: 5, q: 'old', status: 'COMPLETED' });
  const result = validateHistoryFilters({
    ...draft,
    q: ' new ',
    status: 'CANCELLED',
  });
  assert.ok(result.query);
  assert.equal(result.query.page, 1);
  assert.equal(historyUrl(result.query), '/history?status=CANCELLED&q=new');
  assert.equal(
    historyUrl(validateHistoryFilters(filterDraft({})).query ?? {}),
    '/history',
  );
});
void test('timestamp ordering compares instants, accepts equality and one-sided filters; reversed/invalid ranges are not sent', () => {
  const draft = {
    q: '',
    status: '',
    from: '2026-10-12T02:00:00+02:00',
    to: '2026-10-12T00:00:00Z',
  };
  assert.ok(validateHistoryFilters(draft).query);
  assert.ok(validateHistoryFilters({ ...draft, to: '' }).query);
  assert.ok(
    validateHistoryFilters({ ...draft, to: '2026-10-11T23:59:59Z' }).errors?.to,
  );
  assert.ok(
    validateHistoryFilters({ ...draft, from: '2026-02-30T00:00:00Z' }).errors
      ?.from,
  );
  assert.equal(
    historyUrl(
      normalizeHistoryUrl(
        new URLSearchParams({
          from: '2026-10-15T00:00:00Z',
          to: '2026-10-12T00:00:00Z',
        }),
      ),
    ),
    '/history',
  );
});
void test('search/status limits and pagination mirror backend while never filtering downloaded items', () => {
  assert.ok(
    validateHistoryFilters({
      q: '😀'.repeat(100),
      status: 'COMPLETED',
      from: '',
      to: '',
    }).query,
  );
  assert.ok(
    validateHistoryFilters({
      q: 'x'.repeat(101),
      status: 'IN_PROGRESS',
      from: '',
      to: '',
    }).errors?.q,
  );
  assert.equal(validHistoryPagination(1, 100), true);
  assert.equal(validHistoryPagination(107374183, 20), true);
  assert.equal(validHistoryPagination(107374184, 20), false);
});
void test('closed auth returns preserve History filters/deep links and reject external/extra route redirects', () => {
  assert.equal(authReturnPath('/history/id?userId=x'), '/history/id');
  assert.equal(
    authReturnPath('/history?userId=x&status=COMPLETED'),
    '/history?status=COMPLETED',
  );
  for (const value of [
    '//evil.test/history',
    '/history/id/more',
    '/history/../../other',
    'https://evil.test/history',
  ])
    assert.equal(authReturnPath(value), '/dashboard');
});
void test('History runtime contracts use dedicated counts and only terminal snapshots without catalog requirements', () => {
  assert.ok(isHistoryPage(historyPage()));
  assert.ok(isHistoryDetail(historyDetail()));
  assert.equal(
    isHistoryPage({
      ...historyPage(),
      items: [{ ...historyPage().items[0], status: 'IN_PROGRESS' }],
    }),
    false,
  );
  assert.equal(
    isHistoryDetail({ ...historyDetail(), status: 'IN_PROGRESS' }),
    false,
  );
  assert.equal(
    isHistoryPage({ ...historyPage(), items: [{ id: 'partial' }] }),
    false,
  );
});
