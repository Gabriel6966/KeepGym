import { AuthIcon } from './auth-icon';
import Image from 'next/image';
import Link from 'next/link';
import { useReducer, type PointerEvent, type Ref } from 'react';
import { entryInteractionTransition } from './auth-transitions';

export function AuthEntryCard({
  onEnter,
  aboutHref,
  disabled = false,
  leaving = false,
  enterRef,
}: {
  onEnter: () => void;
  aboutHref: string;
  disabled?: boolean;
  leaving?: boolean;
  enterRef?: Ref<HTMLButtonElement>;
}) {
  const [activeSide, interact] = useReducer(entryInteractionTransition, null);
  function pointAt(side: 'about' | 'access', event: PointerEvent) {
    interact({
      type: 'pointer',
      side,
      hoverCapable:
        event.pointerType === 'mouse' &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    });
  }
  return (
    <section
      className="auth-entry"
      data-active={activeSide ?? 'none'}
      aria-label="Información y acceso a KeepGym"
      onPointerLeave={() => interact({ type: 'leave' })}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          interact({ type: 'leave' });
      }}
      inert={leaving || undefined}
      aria-hidden={leaving || undefined}
    >
      <Image
        className="auth-gym-photo"
        src="/images/auth/gym-hand.png"
        alt=""
        width={1024}
        height={1536}
        unoptimized
        loading="eager"
      />
      <div className="auth-about-shadow">
        <Link
          href={aboutHref}
          aria-label="Sobre nosotros"
          prefetch={false}
          className="auth-about-zone"
          onPointerEnter={(event) => pointAt('about', event)}
          onFocus={() => interact({ type: 'focus', side: 'about' })}
        >
          <div className="auth-about-content">
            <h1>
              Sobre
              <br />
              nosotros
            </h1>
            <p>
              Un lugar para registrar
              <br />
              tu entrenamiento y ver
              <br />
              tu evolución.
            </p>
            <span className="auth-about-action">
              Conocer KeepGym
              <AuthIcon name="arrow-right" />
            </span>
          </div>
        </Link>
      </div>
      <div
        className="auth-access-content"
        onPointerEnter={(event) => pointAt('access', event)}
        onFocus={() => interact({ type: 'focus', side: 'access' })}
      >
        <h2>Empieza aquí</h2>
        <button
          ref={enterRef}
          type="button"
          className="auth-button auth-button--primary auth-access-button"
          onClick={onEnter}
          disabled={disabled || leaving}
        >
          Iniciar sesión o registrarse
          <AuthIcon name="arrow-right" />
        </button>
      </div>
    </section>
  );
}
