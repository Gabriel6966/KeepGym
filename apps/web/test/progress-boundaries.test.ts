import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

void test('Progress contains no Epley/PR ownership computation, catalog reconstruction or History Exercise duplicate reads', () => {
  const root = resolve('src/features/progress');
  for (const file of readdirSync(root).filter((file) => /\.tsx?$/.test(file))) {
    const raw = readFileSync(resolve(root, file), 'utf8'),
      source = ts.createSourceFile(
        file,
        raw,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
    assert.doesNotMatch(
      raw,
      /calculateEstimated1RM|estimated1RMScore|analytics\.math|sumSetVolumes|\/history\/exercises/,
    );
    function inspect(node: ts.Node) {
      if (ts.isCallExpression(node))
        assert.doesNotMatch(
          node.expression.getText(source),
          /\.sort$|getExerciseCatalogDetail|getExerciseHistory/,
        );
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.AsteriskToken
      )
        assert.doesNotMatch(node.getText(source), /loadKg|reps/);
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
});
