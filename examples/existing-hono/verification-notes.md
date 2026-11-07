# Local execution notes

Requirement `HONO-AUTH-001` and its acceptance cases T1–T4 were written before
the implementation. The original import-only run failed because `src/app.ts`
did not exist; that was setup evidence, not behavioral RED.

Behavioral RED: with a real Hono factory and no route registered,
`node_modules/.bin/vitest run tests/examples/hono.test.ts` exited 1 with 24/24
tests failing. The HTTP responses were 404 where 200, 401 or 503 was required.
The pure decision and route implementation were added only after that run.

GREEN: the same command exited 0 with 24/24 tests passing.
`node_modules/.bin/tsc --noEmit` exited 0. Tool versions: Node 24.14.1,
Hono 4.13.16, Zod 4.6.7, Vitest 5.1.0, TypeScript 7.0.2.
The current whole suite, `node_modules/.bin/vitest run`, exited 0 with 112/112
tests in 9 files passing in 19.94 seconds. The parent integration task remains
responsible for rebuilding and running the final whole suite after its changes.

An actual root CLI `verify --project examples/existing-hono --json` invocation
ran with the repository's pinned Dafny directory added to `PATH`. Local run
`777503c1-b031-4c57-a5b2-f97868a8d462` recorded a passed source proof for
`canIssueAdminToken_ensures` with a valid assertion batch and an empty assumption
audit. Tools: LemmaScript 0.6.6, Dafny
4.11.0+fcb2042d6d043a2634f0854338c08feeaaaf4ae2 and Z3 4.14.1. The only declared
assumption was `profile:pdd-pure-v1`; no logical precondition was added.

Actual inputs recorded by that run:

| Input | SHA-256 |
| --- | --- |
| `src/domain/auth.ts` | `01e954a77dae0d4b2bdf9c6de38b9680b5352ecfe6b545113a0273b319804cde` |
| `lemmascript.json` | `135e3051eb6f8564cf9531d0c6f0ed864203b57c7bd3e9e654f577d2d2854aae` |
| Generated `.pdd/proofs/src/domain/auth.dfy` and `.dfy.gen`, identical | `6af8f298e287d6e9be3cccd1696c4dc0995ed7ae4dcef59e90a709345999f169` |

The CLI exited 1 with its gate **blocked** because the required
`HONO-AUTH-001-ROUTE` evidence was missing. Its report labeled the dirty local
checkout and approval as pending. This demonstrates that a passed source proof
cannot fill the route-test obligation. Identity truth remains a trusted external
boundary. These historical local observations are neither authenticated CI nor
human review. Generated receipts remain in ignored `.pdd/evidence/` and reports
in `.pdd/reports/`; rerun after any tool, source or specification changes.
