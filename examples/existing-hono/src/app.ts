import { Hono } from 'hono';
import { z } from 'zod';
import { canIssueAdminToken } from './domain/auth.js';

/** The host must resolve and authenticate identity on the server, never from asserted role fields. */
export type TrustedIdentityProvider = (request: Request) => unknown | Promise<unknown>;

const identitySchema = z.object({
  role: z.enum(['admin', 'user']),
  passwordOk: z.boolean(),
});

/** Factory only: the embedding application supplies its existing identity service and server. */
export function createApp(identityProvider: TrustedIdentityProvider): Hono {
  const app = new Hono();
  app.post('/token-decision', async context => {
    try {
      const identity = await identityProvider(context.req.raw);
      if (identity === null || identity === undefined) {
        return context.json({ allowed: false }, 401);
      }
      const parsed = identitySchema.safeParse(identity);
      if (!parsed.success) return context.json({ allowed: false }, 503);
      return context.json({
        allowed: canIssueAdminToken(parsed.data.role, parsed.data.passwordOk),
      });
    } catch {
      return context.json({ allowed: false }, 503);
    }
  });
  return app;
}
