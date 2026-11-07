# Staged adoption in a Hono sample

This is a reproducible sample of adding a proof to one function in an
application shaped like an existing Hono service. No external application,
production rollout, human approval or user study is represented by this sample.
It uses the repository's pinned Hono 4.13.16, Zod 4.6.7 and Vitest 5.1.0.

`src/domain/auth.ts` is the production source of the authorization decision and
its `//@ ensures` equivalence contract. It accepts only `"admin" | "user"` and a
boolean. The proof scope is exactly `canIssueAdminToken`, under the restricted
`pdd-pure-v1` profile described in [compatibility](../../docs/compatibility.md).
The proof does not cover HTTP, Hono, Zod, identity lookup, authentication,
credential storage or token signing. This sample returns a decision and creates
no token.

`createApp(identityProvider)` in `src/app.ts` requires an injected server-side
identity provider. The provider receives the raw `Request`, so an existing host
can resolve an opaque session credential against its own identity service. It
must establish the role and successful authentication itself. The provider is
the explicit trusted boundary `HONO-AUTH-IDENTITY-PROVIDER`: validating the shape
of its output does not establish that its assertions are true. Copying a role
or `passwordOk` field from client JSON or headers into that provider would break
this security boundary.

The route validates the provider's `unknown` result with Zod before calling the
pure function. Client JSON, role headers and query fields never supply either
authorization input. There is no default authenticator, server listener or
production credential in the sample.

| `POST /token-decision` input from provider | Status | JSON |
| --- | --- | --- |
| `{ role: "admin", passwordOk: true }` | 200 | `{ "allowed": true }` |
| Any other valid role/authentication combination | 200 | `{ "allowed": false }` |
| `null` or `undefined` identity | 401 | `{ "allowed": false }` |
| Malformed identity or thrown/rejected lookup | 503 | `{ "allowed": false }` |

The real-route tests live in this example's `tests/route.test.ts`; the repository
root wrapper `tests/examples/hono.test.ts` runs the same cases. They cover the complete four-case domain, asynchronous lookup, missing
and malformed identity, provider exceptions, and client spoofing. The opaque
cookie lookup in one test is a test fixture, not an authentication adapter.

From the repository root, install its locked dependencies and run:

```sh
pnpm install --frozen-lockfile --ignore-scripts --store-dir .tools/pnpm-store
pnpm exec vitest run tests/examples/hono.test.ts
pnpm typecheck
pnpm test
```

To stage adoption in another service, first extract the synchronous decision
and retain its source contract. Then register its requirement, source target
and obligations using the schema shown in this sample's `.pdd/` directory.
Retain the application's authentication service and adapt it explicitly at the
trusted provider boundary. Run behavioral tests against the actual route before
adding any broader guarantee.

The sample includes a nested `.pdd/config.yaml`, requirement and obligation
registry and `lemmascript.json` for the existing root CLI. Build the CLI and
install the pinned proof tools using the repository's setup, then from the
repository root run:

```sh
pnpm build
node scripts/install-dafny.mjs
PATH="$PWD/.tools/dafny-4.11.0/dafny:$PATH" node dist/cli/main.js doctor --project examples/existing-hono
PATH="$PWD/.tools/dafny-4.11.0/dafny:$PATH" node dist/cli/main.js verify --project examples/existing-hono
node dist/cli/main.js report --project examples/existing-hono
```

`tools: {}` selects the pinned Dafny/Z3 toolchain through `PATH` for the nested
project. The source target is `src/domain/auth.ts#canIssueAdminToken`.
The policy permits the technical profile and the explicitly trusted
`identity-provider:authentic-server-session` boundary. Neither is an external
human approval of the specification or the authentication implementation.

The source-proof obligation and all 24 named route cases are registered separately.
`verify` runs both and binds the caller/validator source to the route evidence.
The report displays the identity-provider assumption and boundary explicitly.
Missing/skipped tests or changed caller/validator inputs block or stale the gate.
The actual source proof and route cases pass as a local trial; a protected CI
pass additionally needs authenticated provenance and a current human review.

Directly used API references: [Hono app/request](https://hono.dev/docs/api/hono),
[Zod parsing](https://zod.dev/basics).
