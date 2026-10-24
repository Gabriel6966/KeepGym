import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthEntryCard } from '../src/features/auth/auth-entry-card';
import {
  AuthPageShell,
  AuthLoading,
} from '../src/features/auth/auth-page-shell';
import { AuthAbout } from '../src/features/auth/auth-about';
import { LoginFields } from '../src/features/auth/login-fields';
import { RegisterForm } from '../src/features/auth/register-form';
import {
  authEntryTransition,
  createPageTurn,
  entryRevealMs,
  pageTurnMs,
  entryInteractionTransition,
  type EntrySide,
} from '../src/features/auth/auth-transitions';
import { authReturnPath } from '../src/features/auth/return-path';
import { afterProfileCheck } from '../src/features/auth/onboarding-routing';

const idle = () => undefined;
void test('approved entry starts with neither side active, a semantic About link and CTA, never login fields', () => {
  const html = renderToStaticMarkup(
    <AuthPageShell mode="entry">
      <AuthEntryCard
        aboutHref="/sobrenosotros?returnTo=%2Ftemplates"
        onEnter={idle}
      />
    </AuthPageShell>,
  );
  assert.match(html, /lang="es"/);
  assert.match(html, /data-active="none"/);
  assert.match(html, /<h1>Sobre<br\/>nosotros<\/h1>/);
  assert.match(html, /Conocer KeepGym/);
  assert.match(html, /Empieza aquí/);
  assert.match(html, /href="\/sobrenosotros\?returnTo=%2Ftemplates"/);
  assert.match(
    html,
    /<button[^>]*type="button"[^>]*>Iniciar sesión o registrarse/,
  );
  assert.doesNotMatch(html, /<form|<input|type="password"/);
});
void test('session check and Retry remain readable outside the clipped decorative panels', () => {
  const html = renderToStaticMarkup(
    <AuthPageShell
      mode="entry"
      feedback={
        <>
          <p role="alert">No se pudo comprobar tu sesión.</p>
          <button type="button">Reintentar comprobación de sesión</button>
        </>
      }
    >
      <AuthEntryCard aboutHref="/sobrenosotros" onEnter={idle} disabled />
    </AuthPageShell>,
  );
  assert.match(html, /disabled=""/);
  assert.match(html, /role="alert"/);
  assert.ok(html.indexOf('role="alert"') > html.indexOf('</section>'));
  assert.match(html, /Reintentar comprobación de sesión/);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
});
void test('approved organic boundary stays decorative with one About link and one access button', () => {
  const html = renderToStaticMarkup(
    <AuthEntryCard aboutHref="/sobrenosotros" onEnter={idle} />,
  );
  const css = readFileSync(resolve('src/features/auth/auth-entry.css'), 'utf8');
  assert.match(css, /clip-path: shape\(/);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.equal((html.match(/<button /g) ?? []).length, 1);
  assert.doesNotMatch(html, /<svg[^>]*tabindex|<article[^>]*tabindex/i);
});
void test('approved decorative imagery is local with no third-party image or proxy request', () => {
  const html = renderToStaticMarkup(
    <AuthEntryCard aboutHref="/sobrenosotros" onEnter={idle} />,
  );
  const images = (html.match(/<img[^>]+>/g) ?? []).filter((image) =>
    image.includes('class="auth-gym-photo"'),
  );
  assert.equal(images.length, 1);
  for (const image of images) {
    assert.match(image, /alt=""/);
    assert.match(image, /src="\/images\/auth\/gym-hand.png"/);
    assert.doesNotMatch(image, /_next\/image/);
  }
  assert.doesNotMatch(html, /unsplash|https:\/\//);
});
void test('shell carries KeepGym branding and the attached rope asset without device scaffolding or fake links', () => {
  const html = renderToStaticMarkup(
    <AuthPageShell mode="entry" onReplay={idle}>
      <p>Content</p>
    </AuthPageShell>,
  );
  assert.match(html, /aria-label="KeepGym, inicio"/);
  assert.match(html, /href="\/login"/);
  assert.match(html, /aria-label="Repetir animación de entrada"/);
  assert.match(html, /src="\/images\/auth\/dumbbell-rope.png"/);
  assert.doesNotMatch(
    html,
    /MOVE|REPONE|href="#"|phone-frame|status-bar|keyboard-dock|Privacidad|Términos/i,
  );
});
void test('shell shares animation durations with safe navigation fallback', () => {
  const html = renderToStaticMarkup(
    <AuthPageShell turning>
      <p>Form</p>
    </AuthPageShell>,
  );
  assert.match(html, /data-turning="true"/);
  assert.ok(html.includes(`--auth-entry-duration:${entryRevealMs}ms`));
  assert.ok(html.includes(`--auth-turn-duration:${pageTurnMs}ms`));
});
void test('pointer entry selects About or Access and leaving always restores none', () => {
  let side: EntrySide = null;
  for (const next of ['about', 'access', 'about', 'access'] as const) {
    side = entryInteractionTransition(side, {
      type: 'pointer',
      side: next,
      hoverCapable: true,
    });
    assert.equal(side, next);
  }
  assert.equal(entryInteractionTransition(side, { type: 'leave' }), null);
});
void test('keyboard focus uses the same side model, and focus departure clears it', () => {
  for (const side of ['about', 'access'] as const) {
    assert.equal(
      entryInteractionTransition(null, { type: 'focus', side }),
      side,
    );
    assert.equal(entryInteractionTransition(side, { type: 'leave' }), null);
  }
});
void test('touch does not simulate hover or require two taps to reveal the login', () => {
  assert.equal(
    entryInteractionTransition(null, {
      type: 'pointer',
      side: 'access',
      hoverCapable: false,
    }),
    null,
  );
  assert.equal(authEntryTransition('entry', 'open'), 'opening');
});
void test('entry opens once, completes both directions of the flip and keeps routing separate', () => {
  assert.equal(authEntryTransition('entry', 'open'), 'opening');
  assert.equal(authEntryTransition('opening', 'open'), 'opening');
  assert.equal(authEntryTransition('opening', 'revealed'), 'login');
  assert.equal(authEntryTransition('login', 'revealed'), 'login');
  assert.equal(authEntryTransition('login', 'back'), 'closing');
  assert.equal(authEntryTransition('closing', 'closed'), 'entry');
  assert.equal(authEntryTransition('closing', 'back'), 'closing');
  assert.equal(authEntryTransition('opening', 'back'), 'opening');
  assert.equal(authEntryTransition('entry', 'revealed'), 'entry');
  assert.ok(entryRevealMs >= 450 && entryRevealMs <= 700);
});
void test('outgoing cover is inert and hidden from assistive technology during reveal', () => {
  const html = renderToStaticMarkup(
    <AuthEntryCard aboutHref="/sobrenosotros" onEnter={idle} leaving />,
  );
  assert.match(html, /inert=""/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /disabled=""/);
});
void test('real login fields retain names, autocomplete, values and error association', () => {
  const html = renderToStaticMarkup(
    <LoginFields
      email="fixture@example.com"
      password="memory-only password"
      pending={false}
      error="El correo o la contraseña no son correctos."
      onEmail={idle}
      onPassword={idle}
      onSubmit={idle}
    />,
  );
  assert.equal((html.match(/<input/g) ?? []).length, 2);
  assert.match(html, /<label for="email">Correo electrónico/);
  assert.match(html, /<label for="password">Contraseña/);
  const emailInput = html.match(/<input[^>]*name="email"[^>]*>/)?.[0] ?? '';
  const passwordInput =
    html.match(/<input[^>]*name="password"[^>]*>/)?.[0] ?? '';
  assert.match(emailInput, /type="email"/);
  assert.match(emailInput, /autoComplete="email"/i);
  assert.match(passwordInput, /type="password"/);
  assert.match(passwordInput, /autoComplete="current-password"/i);
  assert.match(html, /aria-describedby="login-error"/);
  assert.match(html, /id="login-error" role="alert"/);
  assert.doesNotMatch(html, /name="userId"|remember|username|forgot/i);
});
void test('login pending blocks accidental repeated submits without removing the draft', () => {
  const html = renderToStaticMarkup(
    <LoginFields
      email="fixture@example.com"
      password="in memory"
      pending
      error={null}
      onEmail={idle}
      onPassword={idle}
      onSubmit={idle}
    />,
  );
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
  assert.match(html, /value="fixture@example.com"/);
  assert.match(html, /Iniciando sesión/);
});
void test('navigation disables login controls without falsely announcing a sign-in request', () => {
  const html = renderToStaticMarkup(
    <LoginFields
      email="fixture@example.com"
      password="in memory"
      pending={false}
      disabled
      error={null}
      onEmail={idle}
      onPassword={idle}
      onSubmit={idle}
    />,
  );
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
  assert.match(html, /value="fixture@example.com"/);
  assert.doesNotMatch(html, /Iniciando sesión/);
});
void test('Register direct presentation contains exactly existing email/password/confirm fields and policy', () => {
  const html = renderToStaticMarkup(
    <RegisterForm disabled={false} onRegister={async () => undefined} />,
  );
  assert.equal((html.match(/<input/g) ?? []).length, 3);
  for (const field of ['email', 'password', 'confirmPassword'])
    assert.ok(html.includes(`name="${field}"`));
  assert.match(html, /15 y 128 caracteres/);
  assert.match(html, /Sin combinaciones de caracteres obligatorias/);
  assert.doesNotMatch(html, /Sobre|name="displayName"|name="userId"/);
});
void test('About is factual, linked back to Login and contains no auth form or health promises', () => {
  const html = renderToStaticMarkup(
    <AuthAbout loginHref="/login?returnTo=%2Fhistory" />,
  );
  assert.match(html, /registrar entrenamientos/);
  assert.match(html, /organizar rutinas/);
  assert.match(html, /consultar tu historial/);
  assert.match(html, /href="\/login\?returnTo=%2Fhistory"/);
  assert.doesNotMatch(html, /<form|<input|modal|dialog|BMI|salud|garantiza/i);
});
void test('page turn accepts one activation and navigation, even if fallback and animation both finish', () => {
  let scheduled: (() => void) | undefined,
    delay = 0,
    cancelled = 0,
    navigations = 0;
  const turn = createPageTurn(
    () => navigations++,
    (finish, ms) => {
      scheduled = finish;
      delay = ms;
      return () => {
        cancelled++;
      };
    },
  );
  assert.equal(turn.start(false), true);
  assert.equal(turn.start(false), false);
  assert.equal(navigations, 0);
  assert.equal(delay, pageTurnMs);
  assert.ok(pageTurnMs >= 400 && pageTurnMs <= 700);
  turn.finish();
  scheduled?.();
  turn.finish();
  assert.equal(navigations, 1);
  assert.equal(cancelled, 1);
});
void test('page turn fallback completes safely when animationend is not delivered', () => {
  let scheduled: (() => void) | undefined,
    navigations = 0;
  const turn = createPageTurn(
    () => navigations++,
    (finish) => {
      scheduled = finish;
      return idle;
    },
  );
  turn.start(false);
  scheduled?.();
  assert.equal(navigations, 1);
  assert.equal(turn.start(false), false);
});
void test('reduced motion navigates immediately once, without creating a timer', () => {
  let navigations = 0,
    timers = 0;
  const turn = createPageTurn(
    () => navigations++,
    () => {
      timers++;
      return idle;
    },
  );
  turn.start(true);
  turn.start(true);
  turn.finish();
  assert.equal(navigations, 1);
  assert.equal(timers, 0);
});
void test('unmount cancels pending turn and an already queued late finish cannot navigate', () => {
  let scheduled: (() => void) | undefined,
    navigations = 0,
    cancelled = 0;
  const turn = createPageTurn(
    () => navigations++,
    (finish) => {
      scheduled = finish;
      return () => {
        cancelled++;
      };
    },
  );
  turn.start(false);
  turn.dispose();
  scheduled?.();
  turn.finish();
  assert.equal(navigations, 0);
  assert.equal(cancelled, 1);
  assert.equal(turn.start(false), false);
});
void test('safe return and existing Profile/onboarding destinations remain owned by existing helpers', () => {
  const safe = authReturnPath('/history?status=CANCELLED&page=2');
  assert.equal(afterProfileCheck(true, safe), safe);
  assert.match(afterProfileCheck(false, safe), /^\/onboarding\?returnTo=/);
  for (const unsafe of [
    'https://evil.example',
    '//evil.example',
    '/login',
    '/register',
  ])
    assert.equal(authReturnPath(unsafe), '/dashboard');
});
void test('Auth loading has a deterministic semantic status and the same shell', () => {
  const html = renderToStaticMarkup(<AuthLoading />);
  assert.match(html, /role="status"/);
  assert.match(html, /Comprobando sesión/);
  assert.doesNotMatch(html, /<input/);
});
void test('animation and About components cannot introduce API requests or browser-dependent initial markup', () => {
  for (const file of [
    'auth-transitions.ts',
    'use-page-turn.ts',
    'auth-entry-card.tsx',
    'auth-page-shell.tsx',
    'auth-about.tsx',
    'login-fields.tsx',
  ]) {
    const source = readFileSync(resolve('src/features/auth', file), 'utf8');
    assert.doesNotMatch(
      source,
      /api-client|\bfetch\s*\(|localStorage|window\.innerWidth/,
    );
  }
  const css = readFileSync(resolve('src/features/auth/auth-entry.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce/);
  const entry = readFileSync(
    resolve('src/features/auth/auth-entry-card.tsx'),
    'utf8',
  );
  assert.match(entry, /hover: hover/);
  assert.match(css, /focus-visible/);
  assert.match(css, /-webkit-autofill/);
  assert.doesNotMatch(
    css,
    /@import|auth-entry-fold|auth-entry__veil|auth-entry__weight/,
  );
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:body|:root|footer)\s*\{/);
  assert.match(css, /\.auth-page \*::after/);
});
