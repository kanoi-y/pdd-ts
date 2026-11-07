# Local execution notes

Requirement `SPLIT-001` and acceptance cases T1–T3 were recorded before the
implementation. An initial import-only run failed because the source did not
exist; it is setup evidence, not behavioral RED.

Behavioral RED: `node_modules/.bin/vitest run tests/examples/greenfield.test.ts`
exited 1 with 31 failed and 3 passed cases. The temporary zero-share domain and
unvalidated success facade failed allocation/conservation expectations and
accepted malformed inputs. The real implementation was added after that run.

GREEN: the same cases executed with Vitest's JSON reporter exited 0 with 34/34
passing. `node_modules/.bin/tsc --noEmit` exited 0. The required test full names in
`.pdd/config.yaml` were taken from that actual execution report. Versions:
Node 24.14.1, TypeScript 7.0.2, Vitest 5.1.0 and Zod 4.6.7.

Proof scope is the production `src/domain/split.ts`, with source contract
premises `total >= 0n` and `requested >= 0n`, and no added trusted assumption.
Its logical postconditions are nonnegative shares and total conservation;
clamping is tested behavior. The root integration task runs the current whole
suite after all implementation changes. These local notes are not a protected
CI receipt or human approval.

Actual nested CLI execution:
`PATH="$PWD/.tools/dafny-4.11.0/dafny:$PATH" node dist/cli/main.js verify --project examples/greenfield-domain --json`
exited 0. Run `c062f256-f8f4-4d0d-98ca-ca4578241885` recorded both
`SPLIT-001-PROOF` and `SPLIT-001-TEST` as passed. All 34 registered cases ran,
with no failed or skipped cases; no diagnostic or gate finding was reported.
The resulting gate was **trial**, origin **local**, approval **pending**.

The proof used LemmaScript 0.6.6, Dafny
4.11.0+fcb2042d6d043a2634f0854338c08feeaaaf4ae2 and Z3 4.14.1, under the sole
declared profile assumption `profile:pdd-pure-v1`. Source/proof aggregate digest:
`fc94ecc32c6b21fad1df0c358ab5303fb8d6b1f7e22d54f8f3f220bc4657d3ef`.
Actual proof input digest:
`0004817926b6a755a39020c66b17e13739ecffe347a119536dcc0166c3462502`.
Empirical source digest (standalone test, facade, pure function and registered
caller/validator scope):
`5316656ee6458d437172bdbe58993d2ec3676c2e6e2b9eb52b8a79dff25a5399`.
The actual per-file hashes, generated Dafny inputs, premise witnesses, toolchain
manifest, audit, positive verified-member log and empirical JSON report are in
the ignored receipt directory `.pdd/evidence/c062f256-f8f4-4d0d-98ca-ca4578241885/`.
They must be regenerated after changes rather than treating this note as fresh
evidence or an externally authenticated result.
