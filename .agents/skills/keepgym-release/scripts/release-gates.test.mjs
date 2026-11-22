import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateRelease, REPOSITORY } from './release-gates.mjs';

const branch = 'feat/example-release';
const approvedHead = '1'.repeat(40);
const releaseSha = '2'.repeat(40);
const mergeSha = '3'.repeat(40);
const unexpectedSha = '4'.repeat(40);

function beforeCommit() {
  return {
    authorization: {
      explicit: true,
      repository: REPOSITORY,
      base: 'main',
      branch,
      approvedHead,
      previousRemote: null,
      releaseSha: null,
      scope: 'APPROVED',
      specPlan: 'APPROVED',
      visual: 'NOT_REQUIRED',
      smoke: 'NOT_REQUIRED',
      final: 'PASS',
    },
    repository: {
      github: REPOSITORY,
      originFetch: REPOSITORY,
      originPush: REPOSITORY,
      defaultBranch: 'main',
      authenticated: true,
      canWrite: true,
      ciConfigured: true,
      enforcedForActor: true,
      requiredChecks: ['verify'],
      mergeMethod: 'MERGE',
    },
    local: {
      checkoutBranch: branch,
      branchSha: approvedHead,
      trackingSha: null,
      changes: 'APPROVED',
    },
    remote: { branchSha: null },
    pr: null,
  };
}

function afterCommit() {
  const snapshot = beforeCommit();
  snapshot.authorization.releaseSha = releaseSha;
  snapshot.local.branchSha = releaseSha;
  snapshot.local.changes = 'CLEAN';
  return snapshot;
}

function openPr() {
  const snapshot = afterCommit();
  snapshot.remote.branchSha = releaseSha;
  snapshot.pr = {
    number: 123,
    url: 'https://' + REPOSITORY + '/pull/123',
    repository: REPOSITORY,
    headRepository: REPOSITORY,
    base: 'main',
    branch,
    headSha: releaseSha,
    state: 'OPEN',
    pending: 'NONE',
    draft: false,
    reviews: 'CLEAR',
    conversations: 'CLEAR',
    mergeable: true,
    otherRulesSatisfied: true,
    checkSha: releaseSha,
    checks: [{ key: 'verify', sha: releaseSha, status: 'SUCCESS' }],
  };
  return snapshot;
}

function mergedPr() {
  const snapshot = openPr();
  snapshot.pr.state = 'MERGED';
  snapshot.pr.mergedAt = '2026-11-21T10:00:00Z';
  snapshot.pr.mergeCommitSha = mergeSha;
  snapshot.local.trackingSha = releaseSha;
  snapshot.cleanup = {
    releaseInMain: true,
    mergeCommitInMain: true,
    releaseInMerge: true,
    main: 'CURRENT',
    worktree: 'OWN_ATTACHED',
    canDeleteRemote: true,
    canDeleteLocal: true,
  };
  return snapshot;
}

function expectNext(snapshot, action) {
  assert.deepEqual(evaluateRelease(snapshot), { status: 'NEXT', action });
}

function expectBlocked(snapshot, reason) {
  assert.deepEqual(evaluateRelease(snapshot), { status: 'BLOCKED', reason });
}

test('la rama correcta propone commit con los cambios aprobados', () => {
  expectNext(beforeCommit(), 'COMMIT_APPROVED_FILES');
});

test('una rama distinta o main bloquean las escrituras', () => {
  const snapshot = beforeCommit();
  snapshot.local.checkoutBranch = 'feat/other';
  expectBlocked(snapshot, 'WRONG_BRANCH');
  snapshot.authorization.branch = 'main';
  expectBlocked(snapshot, 'BRANCH_NOT_ALLOWED');
});

test('un árbol sucio con cambios ajenos bloquea commit y push', () => {
  const snapshot = beforeCommit();
  snapshot.local.changes = 'UNEXPECTED';
  expectBlocked(snapshot, 'WORKTREE_NOT_APPROVED');

  const committed = afterCommit();
  committed.local.changes = 'UNEXPECTED';
  expectBlocked(committed, 'WORKTREE_NOT_CLEAN');
});

test('la invocación sola y un FINAL ausente no autorizan escrituras', () => {
  const snapshot = beforeCommit();
  snapshot.authorization.explicit = false;
  expectBlocked(snapshot, 'AUTHORIZATION_REQUIRED');
  snapshot.authorization.explicit = true;
  snapshot.authorization.final = 'QUICK';
  expectBlocked(snapshot, 'APPROVAL_EVIDENCE_MISSING');
});

test('la URL efectiva de push tiene que apuntar al repositorio aprobado', () => {
  const snapshot = beforeCommit();
  snapshot.repository.originPush = 'github.com/example/KeepGym';
  expectBlocked(snapshot, 'REPOSITORY_UNVERIFIED');
});

test('un check obligatorio pendiente o aún ausente impide avanzar', () => {
  const snapshot = openPr();
  snapshot.pr.checks[0].status = 'PENDING';
  assert.deepEqual(evaluateRelease(snapshot), {
    status: 'WAIT',
    reason: 'CHECKS_PENDING',
  });
  snapshot.pr.checks = [];
  assert.deepEqual(evaluateRelease(snapshot), {
    status: 'WAIT',
    reason: 'CHECKS_PENDING',
  });
});

test('un check fallido o cancelado bloquea el merge', () => {
  const snapshot = openPr();
  for (const status of ['FAILURE', 'CANCELLED']) {
    snapshot.pr.checks[0].status = status;
    expectBlocked(snapshot, 'CHECKS_FAILED');
  }
});

test('sin CI requerido y verificable no hay merge aunque existan checks verdes', () => {
  const snapshot = openPr();
  snapshot.repository.requiredChecks = [];
  expectBlocked(snapshot, 'NO_REQUIRED_CI');
  snapshot.repository.requiredChecks = ['verify'];
  snapshot.repository.ciConfigured = false;
  expectBlocked(snapshot, 'NO_REQUIRED_CI');
  delete snapshot.repository.ciConfigured;
  expectBlocked(snapshot, 'REQUIRED_CI_UNVERIFIED');
});

test('checks de un SHA anterior, omitidos o ambiguos no acreditan éxito', () => {
  const snapshot = openPr();
  snapshot.pr.checks[0].sha = unexpectedSha;
  assert.deepEqual(evaluateRelease(snapshot), {
    status: 'WAIT',
    reason: 'CHECKS_PENDING',
  });
  snapshot.pr.checks[0] = { key: 'verify', sha: releaseSha, status: 'SKIPPED' };
  expectBlocked(snapshot, 'REQUIRED_CHECK_WITHOUT_SUCCESS');
  snapshot.pr.checks.push({
    key: 'verify',
    sha: releaseSha,
    status: 'SUCCESS',
  });
  expectBlocked(snapshot, 'AMBIGUOUS_REQUIRED_CHECK');
});

test('el SHA de merge de prueba necesita vincularse al PR vigente', () => {
  const snapshot = openPr();
  snapshot.pr.checkSha = mergeSha;
  snapshot.pr.checks[0].sha = mergeSha;
  expectBlocked(snapshot, 'REQUIRED_CI_UNVERIFIED');
  snapshot.pr.testMergeSha = mergeSha;
  expectNext(snapshot, 'MERGE_EXPECTED_SHA');
});

test('reutiliza un PR existente y frena si está cerrado o no se puede identificar', () => {
  const snapshot = openPr();
  expectNext(snapshot, 'MERGE_EXPECTED_SHA');
  snapshot.pr.state = 'CLOSED';
  expectBlocked(snapshot, 'PR_NOT_OPEN');
  delete snapshot.pr;
  expectBlocked(snapshot, 'PR_LOOKUP_UNVERIFIED');
});

test('detecta cambios del SHA aprobado en la rama local, remota y PR', () => {
  const snapshot = openPr();
  snapshot.local.branchSha = unexpectedSha;
  expectBlocked(snapshot, 'LOCAL_SHA_CHANGED');
  snapshot.local.branchSha = releaseSha;
  snapshot.remote.branchSha = unexpectedSha;
  expectBlocked(snapshot, 'REMOTE_SHA_CHANGED');
  snapshot.remote.branchSha = releaseSha;
  snapshot.pr.headSha = unexpectedSha;
  expectBlocked(snapshot, 'PR_IDENTITY_CHANGED');
});

test('un PR a otra base o desde un fork no se adopta', () => {
  const snapshot = openPr();
  snapshot.pr.base = 'develop';
  expectBlocked(snapshot, 'PR_IDENTITY_CHANGED');
  snapshot.pr.base = 'main';
  snapshot.pr.headRepository = 'github.com/example/KeepGym';
  expectBlocked(snapshot, 'PR_IDENTITY_CHANGED');
});

test('reviews pendientes, conversaciones o conflictos impiden el merge', () => {
  const snapshot = openPr();
  snapshot.pr.reviews = 'PENDING';
  assert.deepEqual(evaluateRelease(snapshot), {
    status: 'WAIT',
    reason: 'REVIEWS_PENDING',
  });
  snapshot.pr.reviews = 'CLEAR';
  snapshot.pr.conversations = 'BLOCKED';
  expectBlocked(snapshot, 'CONVERSATIONS_BLOCKED');
  snapshot.pr.conversations = 'CLEAR';
  snapshot.pr.mergeable = false;
  expectBlocked(snapshot, 'MERGE_REQUIREMENTS_BLOCKED');
});

test('el actor está sujeto a las protecciones y el método preserva el SHA', () => {
  const snapshot = openPr();
  snapshot.repository.enforcedForActor = false;
  expectBlocked(snapshot, 'PROTECTIONS_NOT_ENFORCED');
  snapshot.repository.enforcedForActor = true;
  snapshot.repository.mergeMethod = 'SQUASH';
  expectBlocked(snapshot, 'MERGE_METHOD_UNSUPPORTED');
});

test('una cola configurada propone encolar con SHA, o espera sin iniciar cleanup', () => {
  const snapshot = openPr();
  snapshot.repository.mergeMethod = 'QUEUE_MERGE';
  expectNext(snapshot, 'ENQUEUE_EXPECTED_SHA');
  for (const pending of ['QUEUE', 'AUTO']) {
    snapshot.pr.pending = pending;
    assert.deepEqual(evaluateRelease(snapshot), { status: 'PENDING MERGE' });
  }
  snapshot.remote.branchSha = unexpectedSha;
  expectBlocked(snapshot, 'REMOTE_SHA_CHANGED');
});

test('el merge confirmado necesita ambos SHAs en main y fast-forward seguro', () => {
  const snapshot = mergedPr();
  snapshot.cleanup.releaseInMain = false;
  expectBlocked(snapshot, 'MERGE_NOT_PROVEN_ON_MAIN');
  snapshot.cleanup.releaseInMain = true;
  snapshot.cleanup.mergeCommitInMain = false;
  expectBlocked(snapshot, 'MERGE_NOT_PROVEN_ON_MAIN');
  snapshot.cleanup.mergeCommitInMain = true;
  snapshot.cleanup.main = 'FAST_FORWARD';
  expectNext(snapshot, 'SYNC_LOCAL_MAIN');
  snapshot.cleanup.main = 'BLOCKED';
  expectBlocked(snapshot, 'LOCAL_MAIN_BLOCKED');
  snapshot.cleanup.main = 'CURRENT';
  expectNext(snapshot, 'DELETE_REMOTE_BRANCH');
});

test('un worktree ajeno, sucio o bloqueado detiene los borrados', () => {
  const snapshot = mergedPr();
  snapshot.cleanup.worktree = 'BLOCKED';
  expectBlocked(snapshot, 'WORKTREE_BLOCKS_CLEANUP');
  snapshot.cleanup.worktree = 'NONE';
  expectBlocked(snapshot, 'WORKTREE_BLOCKS_CLEANUP');
});

test('reanuda por observación después de commit, push y creación de PR', () => {
  expectNext(beforeCommit(), 'COMMIT_APPROVED_FILES');
  const committed = afterCommit();
  expectNext(committed, 'PUSH_EXPECTED_SHA');
  committed.remote.branchSha = releaseSha;
  expectNext(committed, 'CREATE_PR');
  expectNext(openPr(), 'MERGE_EXPECTED_SHA');
});

test('reanuda cada paso del cleanup hasta comprobar la sincronización', () => {
  const snapshot = mergedPr();
  expectNext(snapshot, 'DELETE_REMOTE_BRANCH');
  snapshot.remote.branchSha = null;
  expectNext(snapshot, 'DELETE_REMOTE_TRACKING_REF');
  snapshot.local.trackingSha = null;
  expectNext(snapshot, 'DETACH_OWN_WORKTREE');
  snapshot.local.checkoutBranch = null;
  snapshot.cleanup.worktree = 'OWN_DETACHED';
  expectNext(snapshot, 'DELETE_LOCAL_BRANCH');
  snapshot.local.branchSha = null;
  expectNext(snapshot, 'REMOVE_OWN_WORKTREE');
  snapshot.cleanup.worktree = 'NONE';
  assert.deepEqual(evaluateRelease(snapshot), { status: 'COMPLETE' });
  snapshot.cleanup.main = 'FAST_FORWARD';
  expectNext(snapshot, 'SYNC_LOCAL_MAIN');
});

test('una referencia movida o un destino recreado queda fuera del cleanup', () => {
  const snapshot = mergedPr();
  snapshot.remote.branchSha = unexpectedSha;
  expectBlocked(snapshot, 'REMOTE_SHA_CHANGED');
  snapshot.remote.branchSha = releaseSha;
  snapshot.cleanup.remoteDeleted = true;
  expectBlocked(snapshot, 'DELETED_TARGET_REAPPEARED');
  snapshot.remote.branchSha = null;
  snapshot.cleanup.localDeleted = true;
  expectBlocked(snapshot, 'DELETED_TARGET_REAPPEARED');
});

test('DRY RUN y evaluación de release emiten la misma decisión por stdin', () => {
  const script = fileURLToPath(new URL('./release-gates.mjs', import.meta.url));
  for (const [flag, mode] of [
    ['--dry-run', 'DRY RUN'],
    ['--evaluate', 'EVALUATE'],
  ]) {
    const result = spawnSync(process.execPath, [script, flag, '-'], {
      input: JSON.stringify(openPr()),
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      mode,
      status: 'NEXT',
      action: 'MERGE_EXPECTED_SHA',
    });
  }
});

test('la CLI rechaza snapshots inválidos y nunca acepta un modo de escritura', () => {
  const script = fileURLToPath(new URL('./release-gates.mjs', import.meta.url));
  for (const [flag, input] of [
    ['--dry-run', 'invalid'],
    ['--apply', '{}'],
  ]) {
    const result = spawnSync(process.execPath, [script, flag, '-'], {
      input,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
  }
});

test('tras identificar el PR fusionado puede obtener objetos de main sin sugerir borrados', () => {
  const snapshot = mergedPr();
  snapshot.cleanup.mainEvidence = 'FETCH_NEEDED';
  snapshot.cleanup.releaseInMain = false;
  snapshot.cleanup.mergeCommitInMain = false;
  snapshot.cleanup.releaseInMerge = false;
  expectNext(snapshot, 'FETCH_MAIN_EVIDENCE');
  snapshot.pr.mergedAt = null;
  expectBlocked(snapshot, 'MERGE_NOT_PROVEN_ON_MAIN');
});

test('la ref de seguimiento previa tiene que ser ancestro del main observado', () => {
  const snapshot = mergedPr();
  snapshot.authorization.previousRemote = approvedHead;
  snapshot.local.trackingSha = approvedHead;
  snapshot.remote.branchSha = null;
  snapshot.cleanup.trackingInMain = false;
  expectBlocked(snapshot, 'TRACKING_REF_UNVERIFIED');
  snapshot.cleanup.trackingInMain = true;
  expectNext(snapshot, 'DELETE_REMOTE_TRACKING_REF');
});

test('una respuesta perdida al borrar no autoriza repetir contra un objetivo presente', () => {
  const snapshot = mergedPr();
  snapshot.cleanup.interruptedDeletion = 'DELETE_REMOTE_BRANCH';
  expectBlocked(snapshot, 'DELETION_OUTCOME_UNVERIFIED');
  snapshot.remote.branchSha = null;
  expectNext(snapshot, 'DELETE_REMOTE_TRACKING_REF');
  snapshot.cleanup.interruptedDeletion = 'DELETE_REMOTE_TRACKING_REF';
  expectBlocked(snapshot, 'DELETION_OUTCOME_UNVERIFIED');
  snapshot.local.trackingSha = null;
  expectNext(snapshot, 'DETACH_OWN_WORKTREE');
});

test('un PR confirmado puede reanudarse cuando la rama publicada está sin checkout', () => {
  const snapshot = openPr();
  snapshot.local.checkoutBranch = 'main';
  snapshot.local.changes = 'NOT_CHECKED_OUT';
  expectNext(snapshot, 'MERGE_EXPECTED_SHA');
  snapshot.local.checkoutBranch = branch;
  snapshot.local.changes = 'UNEXPECTED';
  expectBlocked(snapshot, 'WORKTREE_NOT_CLEAN');
});

test('el cleanup puede preparar un único worktree propio en main si está autorizado', () => {
  const snapshot = mergedPr();
  snapshot.remote.branchSha = null;
  snapshot.local.trackingSha = null;
  snapshot.local.checkoutBranch = null;
  snapshot.cleanup.worktree = 'NONE';
  snapshot.cleanup.canDeleteLocal = false;
  expectBlocked(snapshot, 'LOCAL_DELETE_BLOCKED');
  snapshot.cleanup.canCreateOwnWorktree = true;
  expectNext(snapshot, 'PREPARE_OWN_MAIN_WORKTREE');
  snapshot.cleanup.worktreeRemoved = true;
  expectBlocked(snapshot, 'LOCAL_DELETE_BLOCKED');
});

test('el job keepgym-ci exige éxito del proveedor requerido para el SHA evaluado', () => {
  const snapshot = openPr();
  const requiredKey = 'keepgym-ci@github-actions';
  snapshot.repository.requiredChecks = [requiredKey];
  snapshot.pr.checks = [
    { key: 'keepgym-ci@other-app', sha: releaseSha, status: 'SUCCESS' },
    { key: requiredKey, sha: unexpectedSha, status: 'SUCCESS' },
  ];
  assert.deepEqual(evaluateRelease(snapshot), {
    status: 'WAIT',
    reason: 'CHECKS_PENDING',
  });

  const job = { key: requiredKey, sha: releaseSha, status: 'SKIPPED' };
  snapshot.pr.checks.push(job);
  expectBlocked(snapshot, 'REQUIRED_CHECK_WITHOUT_SUCCESS');

  job.status = 'SUCCESS';
  expectNext(snapshot, 'MERGE_EXPECTED_SHA');
});
