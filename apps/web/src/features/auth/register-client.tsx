'use client';

import { AuthIcon } from './auth-icon';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { createSubmissionLock } from '../workout/workout-state';
import { authReturnPath } from './return-path';
import { afterProfileCheck } from './onboarding-routing';
import { ambiguousProfileWrite } from '../profile/profile-state';
import { RegisterForm } from './register-form';
import { AuthPageShell } from './auth-page-shell';
import { usePageTurn } from './use-page-turn';

export function RegisterClient() {
  const router = useRouter(),
    params = useSearchParams(),
    lock = useRef(createSubmissionLock());
  const destination = authReturnPath(params.get('returnTo'));
  const loginHref = '/login?' + new URLSearchParams({ returnTo: destination });
  const turn = usePageTurn(loginHref);
  const [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false),
    [pending, setPending] = useState(false),
    [failure, setFailure] = useState<string | null>(null),
    [reconcile, setReconcile] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .getProfile(controller.signal)
      .then((profile) => {
        if (!controller.signal.aborted)
          router.replace(afterProfileCheck(profile !== null, destination));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized') {
          setReady(true);
          setFailure(null);
        } else {
          setReady(false);
          setFailure(
            'No se pudo comprobar tu sesión. Reintenta antes de crear una cuenta.',
          );
        }
      });
    return () => controller.abort();
  }, [retry, destination, router]);
  async function checkSession() {
    if (!lock.current.acquire()) return;
    setPending(true);
    setFailure(null);
    try {
      const profile = await apiClient.getProfile();
      router.replace(afterProfileCheck(profile !== null, destination));
    } catch (error: unknown) {
      setFailure(
        error instanceof ApiError && error.kind === 'unauthorized'
          ? 'No se encontró una sesión activa. Inicia sesión para comprobar si se creó la cuenta.'
          : 'No se pudo consultar tu perfil. Inténtalo de nuevo.',
      );
      setPending(false);
      lock.current.release();
    }
  }
  async function register(email: string, password: string) {
    if (!ready || pending || reconcile || !lock.current.acquire()) return;
    setPending(true);
    setFailure(null);
    try {
      await apiClient.register(email, password);
      setReconcile(true);
      try {
        const profile = await apiClient.getProfile();
        router.replace(afterProfileCheck(profile !== null, destination));
      } catch {
        setFailure(
          'Cuenta creada. Reintenta la consulta del perfil para continuar; no vuelvas a registrarte.',
        );
        setPending(false);
        lock.current.release();
      }
    } catch (error: unknown) {
      const ambiguous = ambiguousProfileWrite(error);
      setReconcile(ambiguous);
      setFailure(
        ambiguous
          ? 'La cuenta podría haberse creado. Comprueba la sesión o inicia sesión antes de volver a registrarte.'
          : error instanceof ApiError && error.status === 409
            ? 'No se pudo crear esta cuenta. Si ya te registraste, inicia sesión.'
            : 'No se pudo crear la cuenta. Revisa los datos e inténtalo de nuevo.',
      );
      setPending(false);
      lock.current.release();
    }
  }
  return (
    <AuthPageShell turning={turn.turning} onTurnEnd={turn.finish}>
      <div className="auth-form-view">
        <Link
          href={loginHref}
          prefetch={false}
          className="auth-back"
          onClick={(event) => {
            if (pending) event.preventDefault();
            else turn.begin(event);
          }}
          aria-disabled={pending || turn.turning}
        >
          <AuthIcon name="arrow-left" />
          Volver
        </Link>
        <p className="auth-eyebrow">TU ESPACIO DE ENTRENAMIENTO</p>
        <h1 className="auth-form-heading">Crear cuenta</h1>
        <p className="auth-intro">Tu próximo entrenamiento empieza aquí.</p>
        {ready && !reconcile ? (
          <RegisterForm
            disabled={pending || turn.turning}
            onRegister={register}
          />
        ) : !failure && !reconcile ? (
          <p role="status" className="auth-status">
            Comprobando sesión…
          </p>
        ) : null}
        {failure && (
          <p role="alert" className="auth-error">
            {failure}
          </p>
        )}
        {reconcile ? (
          <button
            type="button"
            disabled={pending}
            className="auth-button"
            onClick={() => void checkSession()}
          >
            {pending ? 'Consultando perfil…' : 'Comprobar sesión y perfil'}
          </button>
        ) : !ready && failure ? (
          <button
            type="button"
            className="auth-button"
            onClick={() => {
              setFailure(null);
              setRetry((value) => value + 1);
            }}
          >
            Reintentar comprobación de sesión
          </button>
        ) : null}
        <p className="auth-footer">
          ¿Ya tienes una cuenta?{' '}
          <Link
            className="auth-link"
            href={loginHref}
            prefetch={false}
            aria-disabled={pending || turn.turning}
            onClick={(event) => {
              if (pending) event.preventDefault();
              else turn.begin(event);
            }}
          >
            Iniciar sesión
          </Link>
        </p>
      </div>
    </AuthPageShell>
  );
}
