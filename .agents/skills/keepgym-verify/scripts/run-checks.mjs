import { constants } from 'node:os';
import { repositoryRoot, runCommand } from './preflight.mjs';

const commands = {
  lint: ['pnpm', 'lint'],
  typecheck: ['pnpm', 'typecheck'],
  test: ['pnpm', 'test', '--force'],
  build: ['pnpm', 'build'],
  'diff-check': ['git', 'diff', '--check'],
  postgres: ['pnpm', '--filter', '@gym/api', 'test:postgres'],
};
const usage =
  'Usage: node run-checks.mjs [--fail-fast] <lint|typecheck|test|build|diff-check|postgres> ...';
const args = process.argv.slice(2);
const checks = args.filter((argument) => argument !== '--fail-fast');
const failFast = args.includes('--fail-fast');
const unknown = checks.filter((check) => !Object.hasOwn(commands, check));

if (args.length === 1 && args[0] === '--help') {
  console.log(usage);
} else if (
  checks.length === 0 ||
  unknown.length > 0 ||
  new Set(checks).size !== checks.length ||
  args.filter((argument) => argument === '--fail-fast').length > 1
) {
  console.error(
    unknown.length
      ? `Unknown check: ${unknown.join(', ')}.`
      : checks.length === 0
        ? 'At least one check is required.'
        : 'Duplicate checks/options are not allowed.',
  );
  console.error(usage);
  process.exitCode = 2;
} else {
  try {
    const root = repositoryRoot();
    const results = [];
    let stopped = false;
    let exitCode = 0;
    for (const check of checks) {
      if (stopped) {
        results.push({ check, status: 'NOT RUN' });
        continue;
      }
      const [command, ...commandArgs] = commands[check];
      console.log(`\n> ${command} ${commandArgs.join(' ')}`);
      const result = runCommand(command, commandArgs, root, {
        stdio: 'inherit',
      });
      const status = result.error
        ? 'BLOCKED'
        : result.status === 0
          ? 'PASS'
          : 'FAIL';
      const code =
        result.status ??
        (result.signal ? 128 + (constants.signals[result.signal] ?? 0) : 1);
      results.push({
        check,
        status,
        exitCode: result.status,
        signal: result.signal,
      });
      if (result.error) console.error(`${check}: ${result.error.code}`);
      if (status !== 'PASS') {
        exitCode ||= code || 1;
        stopped = failFast || Boolean(result.signal);
      }
    }
    console.log('\nCheck results:');
    for (const result of results) {
      console.log(
        `${result.check}: ${result.status}` +
          (result.exitCode != null ? ` (exit ${result.exitCode})` : '') +
          (result.signal ? ` (${result.signal})` : ''),
      );
    }
    process.exitCode = exitCode;
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
