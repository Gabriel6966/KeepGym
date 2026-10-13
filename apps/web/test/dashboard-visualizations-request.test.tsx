import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiClient } from '../src/lib/api-client';
import { DashboardContent } from '../src/features/dashboard/dashboard-content';
import { populatedDashboard } from './support/dashboard-fixture';

void test('one composed Dashboard GET feeds every visualization, no domain API fan-out from rendering', async (context) => {
  const fixture = populatedDashboard(),
    fetcher = context.mock.fn<typeof fetch>(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/auth/login')
              ? { accessToken: 'memory-test', tokenType: 'Bearer' }
              : fixture,
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
  const client = new ApiClient('https://api.example.test', fetcher);
  await client.login('fixture@example.com', 'a'.repeat(15));
  const before = fetcher.mock.calls.length;
  const summary = await client.getDashboard(
      fixture.weekStart,
      fixture.timezone,
    ),
    html = renderToStaticMarkup(
      <DashboardContent summary={summary} locale="en-US" />,
    );
  assert.match(html, /data-comparison-metric/);
  assert.match(html, /data-muscle-group/);
  assert.match(html, /data-body-metric/);
  assert.equal(fetcher.mock.calls.length - before, 1);
  const url = String(fetcher.mock.calls.at(-1)!.arguments[0]);
  assert.equal(new URL(url).pathname, '/dashboard/summary');
  assert.deepEqual(
    [...new URL(url).searchParams.entries()],
    [
      ['weekStart', '2026-10-12'],
      ['timezone', 'Europe/Madrid'],
    ],
  );
});
void test('new presentation modules have no API-client dependencies, effects, fetch calls or browser measurements', () => {
  for (const file of [
    'dashboard-bars.tsx',
    'dashboard-visualizations.tsx',
    'visual-scale.ts',
  ]) {
    const source = ts.createSourceFile(
      file,
      readFileSync(resolve('src/features/dashboard', file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function inspect(node: ts.Node) {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        assert.doesNotMatch(
          node.moduleSpecifier.text,
          /api-client|lib\/|next\/navigation/,
        );
      if (ts.isCallExpression(node))
        assert.doesNotMatch(
          node.expression.getText(source),
          /\bfetch\b|useEffect|useLayoutEffect|getBoundingClientRect|apiClient/,
        );
      if (ts.isPropertyAccessExpression(node))
        assert.doesNotMatch(
          node.getText(source),
          /window\.innerWidth|document\./,
        );
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
});
