# Greenfield bigint allocation sample

This is a reproducible local sample, with a new domain function, requirements,
source contracts and behavioral tests registered together. It is not an external
pilot, human-approved specification or authenticated CI run.

`src/domain/split.ts` uses `bigint` throughout. For nonnegative `total` and
`requested`, it gives the first share the requested amount clamped to the total
and gives the second share the remainder. Its production `//@` contracts prove
that both shares are nonnegative and their sum equals `total`, conditional on
both input premises. Clamping is covered by executable examples; it is not an
additional formal postcondition in this sample. The contracts and implementation
match the repository's verified restricted-profile fixture.

`src/app.ts` exposes `splitDecimal(input: unknown)`. This runtime facade requires
an object with exactly `total` and `requested`, both strings of 1–256 ASCII decimal
digits. Leading zeros are accepted; outputs use normalized decimal strings. It
rejects negative values, numbers, fractions, exponents, whitespace, hexadecimal,
unknown fields and oversized strings before calling `BigInt` or the domain
function. Validated decimal strings establish the pure function's nonnegative
input premises. The facade returns `{ ok: false }` on malformed data and
`{ ok: true, shares: { first, second } }` on valid data.

For example, `{ total: "10", requested: "3" }` produces shares `"3"` and `"7"`;
requesting `"11"` from `"10"` produces `"10"` and `"0"`. Values beyond JavaScript
`number` precision preserve their individual units. No `number` arithmetic,
division, external service, database, credentials or server listener is used.

The proof scope is only `src/domain/split.ts#split`, under `pdd-pure-v1`.
TypeScript/LemmaScript translation, Dafny/Z3 and the execution environment are
part of the [verification trust base](../../docs/compatibility.md). Zod parsing,
string conversion and the facade call are empirical scope, not formally proved.
The registered `SPLIT-DECIMAL-INPUT` boundary links the actual caller/validator
file and the required runtime-test obligation. It introduces no extra trusted
logical assumption. Callers that bypass the facade must separately establish
both nonnegative premises; this sample does not make such bypasses safe.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run tests/examples/greenfield.test.ts
pnpm typecheck
```

The root wrapper imports `tests/split.test.ts` from this example. The nested
`.pdd/config.yaml` registers that same standalone test file, both source inputs,
three concrete premise witnesses, and the exact full names of every required
case. The required source proof and empirical test are distinct obligations;
missing or skipped tests cannot be replaced by the source proof.

After the repository CLI is built and its pinned proof tools installed, run from
the repository root:

```sh
pnpm build
node scripts/install-dafny.mjs
PATH="$PWD/.tools/dafny-4.11.0/dafny:$PATH" node dist/cli/main.js verify --project examples/greenfield-domain
node dist/cli/main.js report --project examples/greenfield-domain
```

`tools: {}` uses the pinned proof tools on `PATH` for this nested project.
Generated inputs, logs and receipts remain under ignored `.pdd/evidence/` and
`.pdd/proofs/`. `approvedAssumptions: [profile:pdd-pure-v1]` declares the technical
profile, not human approval. Local proof and tests may satisfy the registered
trial obligations while external approval remains pending. A protected CI
decision requires independently authenticated provenance and external review.
