import { readFileSync } from 'node:fs';

export const REPOSITORY = 'github.com/Gabriel6966/KeepGym';

const BASE = 'main';
const approvedOrNotRequired = new Set(['APPROVED', 'NOT_REQUIRED']);
const incompleteChecks = new Set(['SUCCESS', 'PENDING']);
const failedChecks = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
]);

const next = (action) => ({ status: 'NEXT', action });
const blocked = (reason) => ({ status: 'BLOCKED', reason });
const wait = (reason) => ({ status: 'WAIT', reason });

function isSha(value) {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{40}$/.test(value) &&
    value.length === 40 &&
    value !== '0'.repeat(40)
  );
}

function isNullableSha(value) {
  return value === null || isSha(value);
}

function matchesPullRequest(pr, authorization) {
  return (
    pr &&
    isSha(authorization.releaseSha) &&
    Number.isSafeInteger(pr.number) &&
    pr.number > 0 &&
    pr.url === 'https://' + REPOSITORY + '/pull/' + pr.number &&
    pr.repository === REPOSITORY &&
    pr.headRepository === REPOSITORY &&
    pr.base === BASE &&
    pr.branch === authorization.branch &&
    pr.headSha === authorization.releaseSha
  );
}

function evaluateChecks(repository, pr, releaseSha) {
  const required = repository.requiredChecks;
  if (
    !Array.isArray(required) ||
    required.some((key) => typeof key !== 'string' || !key.trim()) ||
    new Set(required).size !== required.length
  ) {
    return blocked('REQUIRED_CI_UNVERIFIED');
  }
  if (required.length === 0 || repository.ciConfigured === false) {
    return blocked('NO_REQUIRED_CI');
  }
  if (
    repository.ciConfigured !== true ||
    !Array.isArray(pr.checks) ||
    !isSha(pr.checkSha) ||
    (pr.checkSha !== releaseSha && pr.checkSha !== pr.testMergeSha)
  ) {
    return blocked('REQUIRED_CI_UNVERIFIED');
  }

  const observations = new Map();
  for (const check of pr.checks) {
    if (!check || check.sha !== pr.checkSha || !required.includes(check.key))
      continue;
    if (observations.has(check.key)) return blocked('AMBIGUOUS_REQUIRED_CHECK');
    observations.set(check.key, check.status);
  }

  const statuses = [...observations.values()];
  if (statuses.some((status) => failedChecks.has(status)))
    return blocked('CHECKS_FAILED');
  if (statuses.some((status) => !incompleteChecks.has(status))) {
    return blocked('REQUIRED_CHECK_WITHOUT_SUCCESS');
  }
  if (observations.size !== required.length || statuses.includes('PENDING')) {
    return wait('CHECKS_PENDING');
  }
  return null;
}

function evaluateMerged(snapshot) {
  const { authorization, local, remote, pr, cleanup } = snapshot;
  const { releaseSha, previousRemote } = authorization;
  if (!pr.mergedAt || !isSha(pr.mergeCommitSha)) {
    return blocked('MERGE_NOT_PROVEN_ON_MAIN');
  }
  if (local.branchSha !== null && local.branchSha !== releaseSha) {
    return blocked('LOCAL_SHA_CHANGED');
  }
  if (remote.branchSha !== null && remote.branchSha !== releaseSha) {
    return blocked('REMOTE_SHA_CHANGED');
  }
  if (cleanup?.mainEvidence === 'FETCH_NEEDED') {
    return next('FETCH_MAIN_EVIDENCE');
  }
  if (
    cleanup?.releaseInMain !== true ||
    cleanup?.mergeCommitInMain !== true ||
    cleanup?.releaseInMerge !== true
  ) {
    return blocked('MERGE_NOT_PROVEN_ON_MAIN');
  }
  if (
    !isNullableSha(local.trackingSha) ||
    (local.trackingSha !== null &&
      local.trackingSha !== releaseSha &&
      (local.trackingSha !== previousRemote || cleanup.trackingInMain !== true))
  ) {
    return blocked('TRACKING_REF_UNVERIFIED');
  }

  const deletionTargets = new Map([
    ['DELETE_REMOTE_BRANCH', remote.branchSha !== null],
    ['DELETE_REMOTE_TRACKING_REF', local.trackingSha !== null],
    ['DELETE_LOCAL_BRANCH', local.branchSha !== null],
    ['REMOVE_OWN_WORKTREE', cleanup.worktree !== 'NONE'],
  ]);
  if (
    cleanup.interruptedDeletion != null &&
    deletionTargets.get(cleanup.interruptedDeletion) !== false
  ) {
    return blocked('DELETION_OUTCOME_UNVERIFIED');
  }
  if (
    (cleanup.remoteDeleted === true && remote.branchSha !== null) ||
    (cleanup.trackingDeleted === true && local.trackingSha !== null) ||
    (cleanup.localDeleted === true && local.branchSha !== null) ||
    (cleanup.worktreeRemoved === true && cleanup.worktree !== 'NONE')
  ) {
    return blocked('DELETED_TARGET_REAPPEARED');
  }
  if (
    !['NONE', 'OWN_ATTACHED', 'OWN_DETACHED'].includes(cleanup.worktree) ||
    (cleanup.worktree === 'NONE' &&
      local.checkoutBranch === authorization.branch) ||
    (cleanup.worktree === 'OWN_ATTACHED' && local.branchSha === null)
  ) {
    return blocked('WORKTREE_BLOCKS_CLEANUP');
  }
  if (cleanup.main === 'FAST_FORWARD') return next('SYNC_LOCAL_MAIN');
  if (cleanup.main !== 'CURRENT') return blocked('LOCAL_MAIN_BLOCKED');
  if (remote.branchSha !== null) {
    return cleanup.canDeleteRemote === true &&
      snapshot.repository.canWrite === true
      ? next('DELETE_REMOTE_BRANCH')
      : blocked('REMOTE_DELETE_BLOCKED');
  }
  if (local.trackingSha !== null) return next('DELETE_REMOTE_TRACKING_REF');
  if (cleanup.worktree === 'OWN_ATTACHED') return next('DETACH_OWN_WORKTREE');
  if (local.branchSha !== null) {
    if (cleanup.canDeleteLocal === true) return next('DELETE_LOCAL_BRANCH');
    if (
      cleanup.worktree === 'NONE' &&
      cleanup.worktreeRemoved !== true &&
      cleanup.canCreateOwnWorktree === true
    ) {
      return next('PREPARE_OWN_MAIN_WORKTREE');
    }
    return blocked('LOCAL_DELETE_BLOCKED');
  }
  if (cleanup.worktree === 'OWN_DETACHED') return next('REMOVE_OWN_WORKTREE');
  return { status: 'COMPLETE' };
}

function evaluateOpenPr(repository, pr, releaseSha) {
  if (pr.state !== 'OPEN') return blocked('PR_NOT_OPEN');
  if (pr.pending !== 'NONE') return blocked('MERGE_STATE_UNVERIFIED');
  if (pr.draft !== false) return blocked('PR_NOT_READY');
  const checks = evaluateChecks(repository, pr, releaseSha);
  if (checks) return checks;
  if (pr.reviews === 'PENDING') return wait('REVIEWS_PENDING');
  if (pr.reviews !== 'CLEAR') return blocked('REVIEWS_BLOCKED');
  if (pr.conversations !== 'CLEAR') return blocked('CONVERSATIONS_BLOCKED');
  if (pr.mergeable !== true || pr.otherRulesSatisfied !== true) {
    return blocked('MERGE_REQUIREMENTS_BLOCKED');
  }
  if (repository.enforcedForActor !== true)
    return blocked('PROTECTIONS_NOT_ENFORCED');
  if (repository.mergeMethod === 'MERGE') return next('MERGE_EXPECTED_SHA');
  if (repository.mergeMethod === 'QUEUE_MERGE')
    return next('ENQUEUE_EXPECTED_SHA');
  return blocked('MERGE_METHOD_UNSUPPORTED');
}

export function evaluateRelease(snapshot) {
  const { authorization, repository, local, remote, pr } = snapshot ?? {};
  if (authorization?.explicit !== true)
    return blocked('AUTHORIZATION_REQUIRED');
  const { branch, approvedHead, releaseSha, previousRemote } = authorization;
  if (
    typeof branch !== 'string' ||
    !branch ||
    branch.toLowerCase() === BASE ||
    branch.startsWith('refs/') ||
    branch.startsWith('-') ||
    /\s/.test(branch)
  ) {
    return blocked('BRANCH_NOT_ALLOWED');
  }
  if (
    authorization.repository !== REPOSITORY ||
    authorization.base !== BASE ||
    repository?.originFetch !== REPOSITORY ||
    repository.originPush !== REPOSITORY ||
    repository.github !== REPOSITORY ||
    repository.defaultBranch !== BASE ||
    repository.authenticated !== true
  ) {
    return blocked('REPOSITORY_UNVERIFIED');
  }
  if (
    authorization.scope !== 'APPROVED' ||
    !approvedOrNotRequired.has(authorization.specPlan) ||
    !approvedOrNotRequired.has(authorization.visual) ||
    !['PASS', 'NOT_REQUIRED'].includes(authorization.smoke) ||
    authorization.final !== 'PASS'
  ) {
    return blocked('APPROVAL_EVIDENCE_MISSING');
  }
  if (
    !isSha(approvedHead) ||
    !isNullableSha(releaseSha) ||
    !isNullableSha(previousRemote) ||
    !isNullableSha(local?.branchSha) ||
    !isNullableSha(remote?.branchSha)
  ) {
    return blocked('REFS_UNVERIFIED');
  }
  if (pr === undefined) return blocked('PR_LOOKUP_UNVERIFIED');
  if (pr !== null && !matchesPullRequest(pr, authorization)) {
    return blocked('PR_IDENTITY_CHANGED');
  }
  if (pr?.state === 'MERGED') return evaluateMerged(snapshot);
  if (pr?.state === 'OPEN' && ['QUEUE', 'AUTO'].includes(pr.pending)) {
    return remote.branchSha === releaseSha
      ? { status: 'PENDING MERGE' }
      : blocked('REMOTE_SHA_CHANGED');
  }
  const published = releaseSha !== null && remote.branchSha === releaseSha;
  if (!published && local.checkoutBranch !== branch)
    return blocked('WRONG_BRANCH');
  if (local.branchSha !== (releaseSha ?? approvedHead))
    return blocked('LOCAL_SHA_CHANGED');
  if (
    remote.branchSha !== previousRemote &&
    (releaseSha === null || remote.branchSha !== releaseSha)
  ) {
    return blocked('REMOTE_SHA_CHANGED');
  }
  if (repository.canWrite !== true)
    return blocked('WRITE_PERMISSION_UNVERIFIED');
  if (releaseSha === null) {
    return local.changes === 'APPROVED'
      ? next('COMMIT_APPROVED_FILES')
      : blocked('WORKTREE_NOT_APPROVED');
  }
  const publishedWithoutCheckout =
    published &&
    local.checkoutBranch !== branch &&
    local.changes === 'NOT_CHECKED_OUT';
  const approvedCheckoutClean =
    local.checkoutBranch === branch && local.changes === 'CLEAN';
  if (!approvedCheckoutClean && !publishedWithoutCheckout) {
    return blocked('WORKTREE_NOT_CLEAN');
  }
  if (remote.branchSha !== releaseSha) {
    return pr === null
      ? next('PUSH_EXPECTED_SHA')
      : blocked('PR_HEAD_NOT_ON_ORIGIN');
  }
  if (pr === null) return next('CREATE_PR');
  return evaluateOpenPr(repository, pr, releaseSha);
}

if (import.meta.main) {
  const [mode, input, ...extra] = process.argv.slice(2);
  if (
    !['--dry-run', '--evaluate'].includes(mode) ||
    !input ||
    extra.length > 0
  ) {
    process.stderr.write(
      'Uso: node release-gates.mjs --dry-run|--evaluate <snapshot.json|->\n',
    );
    process.exitCode = 2;
  } else {
    try {
      const snapshot = JSON.parse(
        readFileSync(input === '-' ? 0 : input, 'utf8'),
      );
      const decision = evaluateRelease(snapshot);
      const label = mode === '--dry-run' ? 'DRY RUN' : 'EVALUATE';
      process.stdout.write(JSON.stringify({ mode: label, ...decision }) + '\n');
      if (decision.status === 'BLOCKED') process.exitCode = 2;
    } catch {
      process.stderr.write('Snapshot JSON ilegible o inválido.\n');
      process.exitCode = 2;
    }
  }
}
