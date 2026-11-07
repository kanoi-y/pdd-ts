import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('HONO-AUTH-001: staged-adoption Hono route', () => {
  // Removing either role/password condition must break a literal truth-table case.
  it.each([
    { role: 'admin', passwordOk: true, allowed: true },
    { role: 'admin', passwordOk: false, allowed: false },
    { role: 'user', passwordOk: true, allowed: false },
    { role: 'user', passwordOk: false, allowed: false },
  ] as const)('T1: $role / $passwordOk returns $allowed', async ({ role, passwordOk, allowed }) => {
    const app = createApp(() => ({ role, passwordOk }));
    const response = await app.request('/token-decision', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ allowed });
  });

  it('T1: awaits the server-side identity and passes its request to the provider', async () => {
    const app = createApp(async request => {
      // Represents a server-side session lookup keyed by an opaque credential.
      // This fixture is not a production authentication implementation.
      await Promise.resolve();
      return request.headers.get('cookie') === 'session=fixture-session'
        ? { role: 'admin', passwordOk: true }
        : undefined;
    });
    const response = await app.fetch(new Request('https://sample.invalid/token-decision', {
      method: 'POST', headers: { cookie: 'session=fixture-session' },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ allowed: true });
  });

  // Treating absent identity as an ordinary decision would break the required 401.
  it.each([undefined, null])('T2: absent identity %s returns 401', async identity => {
    const response = await createApp(() => identity).request('/token-decision', { method: 'POST' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ allowed: false });
  });

  // Removing runtime parsing or adding coercion would let these malformed values authorize.
  it.each([
    {},
    { role: 'admin' },
    { passwordOk: true },
    { role: 'owner', passwordOk: true },
    { role: 'ADMIN', passwordOk: true },
    { role: 'admin', passwordOk: 'true' },
    { role: 'admin', passwordOk: 1 },
    { role: 'admin', passwordOk: null },
    [{ role: 'admin', passwordOk: true }],
    'admin',
    true,
  ])('T2: malformed provider result %# fails closed', async identity => {
    const response = await createApp(() => identity).request('/token-decision', { method: 'POST' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ allowed: false });
  });

  // A fail-open exception handler or exposed provider exception must fail these cases.
  it.each(['throw', 'reject'] as const)('T3: provider %s fails closed', async mode => {
    const app = createApp(() => {
      const error = new Error('private identity-service diagnostic');
      if (mode === 'throw') throw error;
      return Promise.reject(error);
    });
    const response = await app.request('/token-decision', { method: 'POST' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ allowed: false });
  });

  // Reading attacker-supplied role/password values would authorize these requests.
  it.each([
    { role: 'user', passwordOk: true },
    { role: 'admin', passwordOk: false },
    undefined,
  ])('T4: client fields cannot override trusted identity %#', async identity => {
    const app = createApp(() => identity);
    const response = await app.request('/token-decision?role=admin&passwordOk=true', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-role': 'admin',
        'x-password-ok': 'true',
        authorization: 'Bearer client-assertion-is-not-identity',
      },
      body: JSON.stringify({ role: 'admin', passwordOk: true }),
    });
    expect(response.status).toBe(identity === undefined ? 401 : 200);
    expect(await response.json()).toEqual({ allowed: false });
  });

  it('T4: malformed client JSON cannot replace a valid trusted decision', async () => {
    const app = createApp(() => ({ role: 'admin', passwordOk: true }));
    const response = await app.request('/token-decision', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ allowed: true });
  });
});
