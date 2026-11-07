# MVP audit — working release candidate

This is an evidence ledger, not a declaration of production readiness. The user
approved a TypeScript implementation of the PDD workflow and public OSS publication.
No approval by an external human is invented from that authorization.

| Scope | Implemented evidence | Status |
| --- | --- | --- |
| P0 backend/profile | Real LemmaScript/Dafny/Z3 runs, 19 probes, four implementation mutants, 1,230 valid runtime inputs across 1,500 generated samples | Local experiment passed; general translation soundness is a TCB assumption |
| Required gate | Production `canAcceptEvidence` pure conjunction proved; exhaustive/property/runtime checks | Local proof and tests |
| CLI/project/report | Strict bounded YAML, no-clobber init, verify/doctor/report/audit/approve, fresh escaped Markdown/JSON | Compiled CLI integration tests and offline packed install |
| Source specification | All clauses, source refs, metadata/policy digest, body-only stability, affected revision bumps | Real extraction plus fixture transition tests |
| External approval | Numeric allowlist, exact head and digest, latest opinionated review, no bot/self/dismissed review | API fixtures passed; real independent human approval pending |
| Empirical boundary | Actual Vitest named cases, positive counts/no skip, registered caller+validator digests | Actual execution, mutant failure and stale tests |
| CI authenticity | Fixed native gh verification, exact signer/source SAN/SHA/ref/repo ID, candidate/run/attempt/subject binding | Native exact-policy verification passed for main trial42359881713; protected PR success pending |
| Execution authority | Read-only ordinary CI, credential-free Docker worker, separate native signer | Actual hosted Docker worker and separate signer succeeded at42359881713 |
| Hono | Source proof and 24 actual HTTP route cases, server identity validation and spoofing negatives | Actual CLI local trial passed; no external pilot claimed |
| Bigint | Nonnegative/conservation proof, three premise witnesses, 34 actual facade cases | Actual CLI local trial passed |
| Self application | 13 requirements, three required source proofs and named empirical obligations, eleven explicit runtime/frontend boundaries | Clean200-case committed run passed before the new aggregate registration;201-case aggregate check passed; final committed aggregate run pending |
| Direct comparison | Same sources, contracts and tools; local PoC records commands/results/timing | Machine comparison; human effort/review study pending |

## Independent security review

A separate reviewer read all production modules/workflows and principal regressions.
It found a critical source-model substitution: additions-only handproof edits could
introduce proof-only false premises or comment out the generated implementation,
then verify a replacement Dafny body. A clean audit alone was insufficient. The
initial profile now requires freshly regenerated `.dfy.gen` and the verified `.dfy`
to be byte-identical; handwritten additions are rejected. All three behavioral regressions passed; an independent reviewer reran the real adapter suite and confirmed 9/9 GREEN. No formal source contract is
weakened by this restriction.

Primary audit also reproduced a `__proto__` filename omitted from the digest map;
a null-prototype map and a behavioral regression fix it. Oversized extraction inputs
are rejected before a subprocess starts. All these checks protect initial local and
CI scope; they do not establish adversarial soundness of arbitrary JavaScript tests.

## Publication risk checks

- Public metadata scans found no credential/private-key patterns, personal absolute
  machine paths or prohibited unused-tool descriptions in candidate files. Generated
  local receipts/logs/tool caches are ignored, and only a sanitized root plus public commits were pushed.
- Production dependency audit originally found a moderate minimatch amplification
  advisory in two transitive frontend versions. Root pnpm overrides pin 11.0.1;
  repeat audit found zero known advisories. The override is a repository installation
  policy, not a guarantee that downstream package managers inherit it. No npm release
  is published; tarball consumers must retain the same root override policy.
- Actions and the official Node container are commit/digest pinned. Dafny downloads
  use official checksums. Install hooks are disabled. MIT project license; dependency
  licenses/TCB are recorded in compatibility documentation.
- Public `kanoi-y/pdd-ts` (immutable ID1449042266) contains a sanitized root and public fixes. Ordinary mainCI42360913756 and review-headCI42360988736 passed. Actual protection enforces strict checks from ordinary Actions15368 and dedicated App5653976, stale-review dismissal, code-owner review and administrators, with force pushes/deletion disabled. Configuration-only doctor reports ready.

## External release conditions

Exact-head human review requires a reviewer other than the PR author. The initial
single-owner allowlist cannot approve its own owner-authored PR. A separately
appointed maintainer or genuinely separate bot-authored change is needed; no user
credential is used to manufacture a review. Human cognitive-load/understanding
measurements require actual participants and follow the predefined evaluation
protocol. These conditions must remain visible as pending until observed.

A second independent finding showed that the shared Actions App could substitute a same-named protected check. Publisher/doctor now reject App15368 and require a dedicated App with its credential held in a default-branch-only environment; no fallback token is used. Private App5653976 is installed only on pdd-ts, with checks-write and contents/PR/mandatory-metadata read. Its credential is encrypted in a main-only environment. Real protected-check success still requires personal exact-head approval. Unapproved PR run42361441485 stopped before executing candidate tests with the explicit human-approval error; signing/publication were skipped.

## Aggregate example evidence

A completion audit found separate ordinary-CI example trials were insufficient to
claim both samples shared the protected approval-to-CI path. The root registry now
explicitly includes HONO-AUTH-001 and SPLIT-001, every original source clause, the
three bigint premise witnesses, both required source proofs and both actual runtime
boundaries. Their24/34 existing cases remain required in the empirical suite.
The authentic identity-provider premise is visible in the protected snapshot.
An actual-root regression reproduced missing HONO-AUTH-001 before registration;
the fresh whole suite passed201/201 with typecheck/build. Independent review
confirmed the binding; generated root proof models must accompany the commit so
the publisher can recompute freshness without generating candidate files.
Human approval, final aggregate protected execution and human comparison remain
pending; this audit does not assert GateP3 release completion.
