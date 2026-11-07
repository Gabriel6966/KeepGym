import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function repositoryRoot() {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(directory, '.git'))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Repository root not found.');
    directory = parent;
  }
  return directory;
}

export function runCommand(command, args, cwd, options = {}) {
  // Windows needs cmd.exe for the pnpm shim. Only fixed command tokens reach it.
  const batch = process.platform === 'win32' && command === 'pnpm';
  if (batch && args.some((argument) => !/^[\w@./:-]+$/.test(argument))) {
    throw new Error('Unsafe pnpm command argument.');
  }
  return spawnSync(
    batch ? process.env.ComSpec || 'cmd.exe' : command,
    batch ? ['/d', '/s', '/c', ['pnpm', ...args].join(' ')] : args,
    {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      ...options,
      // Disable package-manager downloads/auto-pinning for this child only.
      env: {
        ...process.env,
        COREPACK_ENABLE_NETWORK: '0',
        COREPACK_ENABLE_AUTO_PIN: '0',
        npm_config_manage_package_manager_versions: 'false',
      },
    },
  );
}

function versionParts(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value || '');
  const parts = match?.slice(1).map(Number);
  return parts?.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index])
      return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function engineResult(actual, required) {
  // Only the repo's current formats: X.Y.Z or >=X.Y.Z <MAJOR.
  const range = /^>=(\d+\.\d+\.\d+)\s+<(0|[1-9]\d*)$/.exec(required.trim());
  const minimum = versionParts(range ? range[1] : required.trim());
  const upper = range ? [Number(range[2]), 0, 0] : null;
  if (
    !minimum ||
    (upper &&
      (!Number.isSafeInteger(upper[0]) || compareVersions(minimum, upper) >= 0))
  ) {
    return {
      status: 'FAIL',
      actual,
      required,
      reason: 'Invalid or unsupported engine range.',
    };
  }
  const version = versionParts(actual);
  if (!version) {
    return {
      status: 'BLOCKED',
      actual,
      required,
      reason: 'Version unavailable.',
    };
  }
  return {
    status: (
      upper
        ? compareVersions(version, minimum) >= 0 &&
          compareVersions(version, upper) < 0
        : compareVersions(version, minimum) === 0
    )
      ? 'PASS'
      : 'BLOCKED',
    actual,
    required,
  };
}

export function preflight() {
  const root = repositoryRoot();
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return {
      status: 'FAIL',
      root,
      reason: 'Cannot read valid package.json JSON.',
    };
  }
  if (
    typeof manifest?.engines?.node !== 'string' ||
    typeof manifest?.engines?.pnpm !== 'string'
  ) {
    return {
      status: 'FAIL',
      root,
      reason: 'Node and pnpm engines are required.',
    };
  }

  const probe = { timeout: 15_000, maxBuffer: 1024 * 1024 };
  const pnpm = runCommand('pnpm', ['--version'], root, probe);
  const branch = runCommand(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    root,
    probe,
  );
  const status = runCommand('git', ['status', '--short'], root, probe);
  const pnpmOk = pnpm.status === 0 && !pnpm.error;
  const branchOk = branch.status === 0 && !branch.error;
  const statusOk = status.status === 0 && !status.error;
  const report = {
    root,
    packageManager: manifest.packageManager,
    node: engineResult(process.versions.node, manifest.engines.node),
    pnpm: engineResult(
      pnpmOk ? pnpm.stdout.trim() : null,
      manifest.engines.pnpm,
    ),
    git: {
      status: branchOk && statusOk ? 'PASS' : 'BLOCKED',
      branch: branchOk ? branch.stdout.trim() : null,
      shortStatus: statusOk
        ? status.stdout
            .replace(/\r\n/g, '\n')
            .trimEnd()
            .split('\n')
            .filter(Boolean)
        : null,
    },
  };
  if (!pnpmOk) {
    report.pnpm.reason =
      pnpm.error?.code || `pnpm --version exited ${pnpm.status}.`;
  }
  if (report.git.status !== 'PASS') {
    report.git.reason = 'Git branch/status unavailable.';
  }
  const states = [report.node.status, report.pnpm.status, report.git.status];
  return {
    status: states.includes('FAIL')
      ? 'FAIL'
      : states.includes('BLOCKED')
        ? 'BLOCKED'
        : 'PASS',
    ...report,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let report;
  try {
    report = preflight();
  } catch (error) {
    report = { status: 'FAIL', reason: error.message };
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = { PASS: 0, FAIL: 1, BLOCKED: 2 }[report.status];
}
