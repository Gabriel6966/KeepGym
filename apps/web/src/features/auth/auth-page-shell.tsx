'use client';

import { AuthIcon } from './auth-icon';
import type { CSSProperties, ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  entryRevealMs,
  pageTurnMs,
  type AuthEntryView,
} from './auth-transitions';

const motionTiming: CSSProperties & Record<`--auth-${string}`, string> = {
  '--auth-entry-duration': `${entryRevealMs}ms`,
  '--auth-turn-duration': `${pageTurnMs}ms`,
};

export function AuthPageShell({
  children,
  mode = 'form',
  view,
  turning = false,
  onTurnEnd,
  onRevealEnd,
  feedback,
  onReplay,
  replayDisabled = false,
  animationKey = 0,
}: {
  children: ReactNode;
  feedback?: ReactNode;
  mode?: 'entry' | 'form' | 'about';
  view?: AuthEntryView;
  turning?: boolean;
  onTurnEnd?: () => void;
  onRevealEnd?: () => void;
  onReplay?: () => void;
  replayDisabled?: boolean;
  animationKey?: number;
}) {
  return (
    <main id="main-content" lang="es" className="auth-page">
      <div className="auth-layout">
        <header className="auth-topbar">
          <Link
            className="auth-topbar-brand"
            href="/login"
            prefetch={false}
            aria-label="KeepGym, inicio"
          >
            <svg
              aria-hidden="true"
              className="auth-brand-mark"
              viewBox="0 0 40 40"
              fill="none"
            >
              <path
                d="M8 25.5V14.5M13 28V12M27 28V12M32 25.5V14.5M13 20H27"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
            </svg>
            <span>
              Keep<span>Gym</span>
            </span>
          </Link>
          {onReplay && (
            <button
              type="button"
              className="auth-replay"
              onClick={onReplay}
              disabled={replayDisabled}
              aria-label="Repetir animación de entrada"
            >
              <AuthIcon name="reload" />
              Repetir
            </button>
          )}
        </header>
        <div className="auth-scene" data-mode={mode}>
          {mode === 'entry' && (
            <Image
              key={animationKey}
              className="auth-falling-weight"
              src="/images/auth/dumbbell-rope.png"
              alt=""
              aria-hidden="true"
              width={724}
              height={2172}
              unoptimized
              loading="eager"
            />
          )}
          <div
            className="auth-card"
            data-mode={mode}
            data-view={view}
            data-turning={turning || undefined}
            style={motionTiming}
          >
            <div
              className="auth-flip-inner"
              onTransitionEnd={(event) => {
                if (
                  event.target === event.currentTarget &&
                  event.propertyName === 'transform'
                )
                  onRevealEnd?.();
              }}
            >
              {children}
            </div>
            <div
              aria-hidden="true"
              className="auth-turn-sheet"
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) onTurnEnd?.();
              }}
            />
          </div>
        </div>
        {feedback && <div className="auth-session-feedback">{feedback}</div>}
      </div>
    </main>
  );
}

export function AuthLoading({
  label = 'Comprobando sesión…',
}: {
  label?: string;
}) {
  return (
    <AuthPageShell>
      <div className="auth-form-view">
        <p role="status" className="auth-status">
          {label}
        </p>
      </div>
    </AuthPageShell>
  );
}
