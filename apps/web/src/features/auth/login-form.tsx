'use client';

import { AuthIcon } from './auth-icon';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { apiClient, ApiError } from '../../lib/api-client';
import { authReturnPath } from './return-path';
import { createSubmissionLock } from '../workout/workout-state';
import { afterProfileCheck } from './onboarding-routing';
import { AuthPageShell } from './auth-page-shell';
import { AuthEntryCard } from './auth-entry-card';
import { LoginFields } from './login-fields';
import { authEntryTransition, entryRevealMs } from './auth-transitions';
import { usePageTurn } from './use-page-turn';

export function LoginForm() {
  const router = useRouter(),
    params = useSearchParams();
  const destination = authReturnPath(params.get('returnTo'));
  const registerHref =
    '/register?' + new URLSearchParams({ returnTo: destination });
  const turn = usePageTurn(registerHref);
  const [view, dispatch] = useReducer(authEntryTransition, 'entry');
  const [animationKey, setAnimationKey] = useState(0);
  const transitioning = view === 'opening' || view === 'closing';
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [check, setCheck] = useState<{
    attempt: number;
    status: 'guest' | 'error';
  } | null>(null);
  const access = check?.attempt === attempt ? check.status : 'checking';
  const lock = useRef(createSubmissionLock());
  const heading = useRef<HTMLHeadingElement>(null),
    enter = useRef<HTMLButtonElement>(null),
    opened = useRef(false);

  // Only an explicit unauthorized session is a guest. A valid session continues
  // through the existing Profile routing, independently of visual entry state.
  useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .getProfile(controller.signal)
      .then((profile) => {
        if (!controller.signal.aborted)
          router.replace(afterProfileCheck(profile !== null, destination));
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setCheck({
            attempt,
            status:
              failure instanceof ApiError && failure.kind === 'unauthorized'
                ? 'guest'
                : 'error',
          });
      });
    return () => controller.abort();
  }, [attempt, destination, router]);

  useEffect(() => {
    if (view !== 'opening' && view !== 'closing') return;
    const timer = setTimeout(
      () => dispatch(view === 'closing' ? 'closed' : 'revealed'),
      entryRevealMs,
    );
    return () => clearTimeout(timer);
  }, [view]);
  useEffect(() => {
    if (!opened.current) return;
    if (view === 'entry') enter.current?.focus({ preventScroll: true });
    else if (view === 'login') heading.current?.focus({ preventScroll: true });
  }, [view]);

  function open() {
    if (access !== 'guest' || view !== 'entry') return;
    opened.current = true;
    dispatch('open');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      dispatch('revealed');
  }
  function back() {
    if (pending || signedIn || transitioning || turn.turning) return;
    dispatch('back');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      dispatch('closed');
  }
  async function checkProfile() {
    const profile = await apiClient.getProfile();
    router.replace(afterProfileCheck(profile !== null, destination));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lock.current.acquire()) return;
    setPending(true);
    setError(null);
    try {
      await apiClient.login(email, password);
      setPassword('');
      setSignedIn(true);
      try {
        await checkProfile();
      } catch {
        setError(
          'Has iniciado sesión, pero no se pudo consultar tu perfil. Reintenta la consulta.',
        );
        setPending(false);
        lock.current.release();
      }
    } catch (failure: unknown) {
      setError(
        failure instanceof ApiError && failure.kind === 'unauthorized'
          ? 'El correo o la contraseña no son correctos.'
          : 'No se pudo iniciar sesión. Inténtalo de nuevo.',
      );
      setPending(false);
      lock.current.release();
    }
  }
  async function retryProfile() {
    if (!lock.current.acquire()) return;
    setPending(true);
    setError(null);
    try {
      await checkProfile();
    } catch (failure: unknown) {
      if (failure instanceof ApiError && failure.kind === 'unauthorized') {
        setSignedIn(false);
        setError('Tu sesión ha caducado. Inicia sesión de nuevo.');
      } else setError('No se pudo consultar tu perfil. Inténtalo de nuevo.');
      setPending(false);
      lock.current.release();
    }
  }
  return (
    <AuthPageShell
      mode={view === 'entry' ? 'entry' : 'form'}
      view={view}
      animationKey={animationKey}
      onReplay={() => {
        if (view === 'entry') setAnimationKey((value) => value + 1);
      }}
      replayDisabled={view !== 'entry' || pending || signedIn || turn.turning}
      turning={turn.turning}
      onTurnEnd={turn.finish}
      onRevealEnd={() => dispatch(view === 'closing' ? 'closed' : 'revealed')}
      feedback={
        view === 'entry' && access !== 'guest' ? (
          access === 'error' ? (
            <>
              <p role="alert" className="auth-error">
                No se pudo comprobar tu sesión. Reintenta antes de continuar.
              </p>
              <button
                type="button"
                className="auth-button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Reintentar comprobación de sesión
              </button>
            </>
          ) : (
            <p role="status" className="auth-status">
              Comprobando sesión…
            </p>
          )
        ) : undefined
      }
    >
      {view !== 'login' && (
        <AuthEntryCard
          key={animationKey}
          aboutHref={
            '/sobrenosotros?' + new URLSearchParams({ returnTo: destination })
          }
          onEnter={open}
          disabled={access !== 'guest'}
          leaving={transitioning}
          enterRef={enter}
        />
      )}
      {view !== 'entry' && (
        <div
          className="auth-form-view auth-form-view--login"
          inert={transitioning || undefined}
          aria-hidden={transitioning || undefined}
        >
          <button
            type="button"
            className="auth-back"
            disabled={pending || signedIn || turn.turning || transitioning}
            onClick={back}
          >
            <AuthIcon name="arrow-left" />
            Volver
          </button>
          <p className="auth-eyebrow">TU ESPACIO DE ENTRENAMIENTO</p>
          <h1 ref={heading} tabIndex={-1} className="auth-form-heading">
            Iniciar sesión
          </h1>
          <p className="auth-intro">Continúa donde lo dejaste.</p>
          {!signedIn && (
            <LoginFields
              email={email}
              password={password}
              pending={pending}
              disabled={turn.turning || transitioning}
              error={error}
              onEmail={setEmail}
              onPassword={setPassword}
              onSubmit={submit}
            />
          )}
          {signedIn && (
            <div className="auth-form">
              <p role="status" className="auth-status">
                {pending
                  ? 'Consultando tu perfil…'
                  : 'Sesión iniciada. Consulta del perfil pendiente.'}
              </p>
              {error && (
                <p role="alert" className="auth-error">
                  {error}
                </p>
              )}
              <button
                type="button"
                disabled={pending}
                className="auth-button"
                onClick={() => void retryProfile()}
              >
                Reintentar consulta del perfil
              </button>
            </div>
          )}
          {!signedIn && (
            <p className="auth-footer">
              ¿No tienes cuenta?{' '}
              <Link
                href={registerHref}
                prefetch={false}
                onClick={(event) => {
                  if (pending) event.preventDefault();
                  else turn.begin(event);
                }}
                aria-disabled={pending || turn.turning}
                className="auth-link"
              >
                Crear cuenta
              </Link>
            </p>
          )}
        </div>
      )}
    </AuthPageShell>
  );
}
