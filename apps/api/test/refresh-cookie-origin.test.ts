import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { CookieOptions, Response } from 'express';
import { OriginGuard } from '../src/auth/guards/origin.guard';
import { RefreshCookieService } from '../src/auth/refresh-cookie.service';
import { testEnvironment } from './support/test-environment';

void test('refresh cookie has HttpOnly, SameSite Lax, /auth scope, configurable Secure and remaining absolute Max-Age', (context) => {
  for (const secure of [false, true]) {
    const config = testEnvironment({
      authRefreshCookieSecure: secure,
      authRefreshCookieName: 'gym_test_refresh',
    });
    const service = new RefreshCookieService(config);
    const response = {
      cookie:
        context.mock.fn<
          (name: string, value: string, options?: CookieOptions) => Response
        >(),
    };
    const expiresAt = new Date(Date.now() + 60000);
    service.set(response, {
      sessionId: 'unit-id',
      userId: 'unit-user',
      refreshToken: 'unit-test-opaque-value',
      expiresAt,
    });
    const args = response.cookie.mock.calls[0]?.arguments;
    assert.ok(args);
    assert.equal(args[0], config.authRefreshCookieName);
    const options = args[2];
    assert.ok(options);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.path, '/auth');
    assert.equal(options.secure, secure);
    assert.equal(options.domain, undefined);
    assert.equal(options.expires, expiresAt);
    assert.ok(
      typeof options.maxAge === 'number' &&
        options.maxAge <= 60000 &&
        options.maxAge > 59000,
    );
  }
});

void test('cookie clearing reuses its scope without keeping a previous lifetime', (context) => {
  const service = new RefreshCookieService(testEnvironment());
  const response = { clearCookie: context.mock.fn<Response['clearCookie']>() };
  service.clear(response);
  assert.deepEqual(response.clearCookie.mock.calls[0]?.arguments, [
    'gym_refresh_token',
    { httpOnly: true, sameSite: 'lax', secure: false, path: '/auth' },
  ]);
});

void test('cookie reading accepts only an own string cookie, never JSON cookies or inherited properties', () => {
  const service = new RefreshCookieService(testEnvironment());
  assert.equal(
    service.read({ cookies: { gym_refresh_token: 'unit-opaque' } }),
    'unit-opaque',
  );
  for (const cookies of [
    undefined,
    null,
    [],
    'cookie',
    { gym_refresh_token: {} },
    { gym_refresh_token: 123 },
    Object.create({ gym_refresh_token: 'inherited' }),
  ]) {
    assert.equal(service.read({ cookies }), undefined);
  }
});

void test('origin guard accepts exactly the configured origin and rejects missing, null and lookalike origins', () => {
  const config = testEnvironment();
  const guard = new OriginGuard(config);
  assert.equal(
    guard.canActivate(
      new ExecutionContextHost([
        { headers: { origin: config.frontendOrigin } },
      ]),
    ),
    true,
  );
  for (const origin of [
    undefined,
    'null',
    'http://evil.example',
    config.frontendOrigin + '.evil.example',
    config.frontendOrigin + '/',
    'https://localhost:3000',
    [config.frontendOrigin],
  ]) {
    assert.throws(
      () =>
        guard.canActivate(new ExecutionContextHost([{ headers: { origin } }])),
      ForbiddenException,
    );
  }
});
