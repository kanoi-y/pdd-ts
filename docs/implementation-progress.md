# Implementation evidence and continuation ledger

## Scope and authority

The user requested implementation through Phase 0–3 of the integrated plan and
application of the same PDD discipline to this project. PDD Kit's philosophy is
intentional; TypeScript support is the motivation. The user has no existing Hono
project and authorized a new public OSS repository after risk review. Public docs
must omit unused tools. A staged-adoption example is not an external pilot.

The active goal is the whole MVP, including real external verification where
required. Local fixtures must not be relabeled as human approval or hosted CI.
Resume from this ledger and the actual worktree/external state.

## Completed local implementation

- T01–T03: pinned local LemmaScript 0.6.6, Dafny 4.11.0 and Z3 4.14.1; official
  archive checksum verified. Real P0 run: 19 positive/excluded/mutation probes;
  four implementation mutants rejected; 1,230 valid runtime inputs across 1,500
  generated samples. Vacuous proof and axiom bypass reproduced. Results are in
  `docs/evidence/p0-results.json`; they do not prove general translation soundness.
- T04–T05: strict evidence schemas and fail-closed pure gate; production
  `canAcceptEvidence` source proved with 1 verified/0 errors. Bounded no-shell
  process execution, path/symlink containment, source profile, premise witnesses,
  real generation/audit/member logs, toolchain fingerprints, fresh input/artifact
  checks and non-overwriting runs. Initial suites passed 29, then 60, then 72 tests.
- T06–T07: AI-free compiled CLI, strict bounded YAML, no-clobber init, explicit
  local trials, escaped Markdown/JSON packets, complete source-clause/spec digest,
  syntactic protected-spec diff and affected-requirement revision enforcement.
  Real packed executable offline install/help/init passed.
- T08: online GitHub client, immutable reviewer IDs, exact head/spec binding,
  latest opinionated human review, rejected self/bot/dismissed/stale approvals,
  bounded committed data-only baseline extraction and reference-only approval.
  API fixtures establish behavior, not a real human review.
- T09: fixed Vitest invocation with required named cases and consistent positive
  counts, no skip/zero acceptance, explicit caller/validator/test registration and
  current hashes. Actual validator test passes, its mutant fails, and validator
  edits stale the receipt. Missing registered boundaries block.
- T10 code: exact native gh attestation policy and signed candidate/run/attempt
  binding; ordinary read-only CI; credential-free Docker test worker; separate
  signer and dedicated-App publisher. Candidate executable overrides are forbidden.
  Doctor rejects the shared Actions issuer and checks protected environment/branch
  policies. Real hosted execution and owner App registration remain next.
- T11 examples: actual Hono route with server identity provider, Zod validation,
  source proof and 24 route cases; bigint conservation/nonnegative source proof,
  three premise witnesses and 34 facade cases. Both actual CLI flows passed as
  local trials. Negative CLI flows blocked auth bypass, skipped cases, impossible
  premise and lost money. Self registry has 11 requirements, two obligations and
  nine explicit trust boundaries; clean committed self run is the next check.

## Test-first findings and independent review

Behavioral RED preceded core gates, source adapter, CLI/spec/approval/boundary
features and examples. Setup-only import failures are not counted as behavioral
RED. The Hono scaffold produced 24 actual 404 failures; bigint placeholders
produced 31 failures before their implementations.

Primary audit reproduced `__proto__` file bytes disappearing from a plain-object
hash map. A null-prototype map fixes it, with actual RED/GREEN. Oversized source
extraction is rejected before invoking a tool.

Independent whole-repository review found a critical model-substitution flaw:
additions-only Dafny permitted a false lemma premise or commented-out/replaced
model with a clean audit. Primary reproduced all three attacks including forged
sidecars. The initial profile now requires freshly generated `.dfy.gen` and verified
`.dfy` byte equality. Arbitrary handwritten Dafny extensions are unsupported;
no source contract or witness was weakened. Reviewer independently reran the
real adapter: 9/9 GREEN.

A second independent finding showed same-name checks from the shared Actions
App could substitute for protected publication. Publisher and doctor now reject
that issuer. Dedicated App credentials belong only in a main-only environment;
actual response issuer is checked. Reviewer confirmed authority changes and ran
doctor/provenance 9/9 plus typecheck. Manifest permissions are prepared but actual
registration/installation is not invented.

## Evaluation and publication evidence

- Current full suite: 188/188, 0 failed/pending, plus typecheck/build; the final full check after token-routing/environment changes also passed (17 files, 29.26s).
- Updated-backend PoC passed; real packed offline install/help/init passed with
  the repository's dependency override policy.
- Root production audit: moderate minimatch amplification finding fixed with
  root pnpm override 11.0.1; repeated audit 0 known advisories. Downstream tarball
  consumers must retain that override policy; no npm publication is requested.
- Same-source machine comparison: direct tools approximately 5.2s, pdd-ts 7.3s
  on each fixture, 24/34 cases. One observation per fixture, counterbalanced order;
  added PDD safety/packet work differs. No human-effort or usability conclusion.
- Candidate source scans found no credential/private-key patterns, personal
  absolute machine paths or prohibited unused-tool descriptions. Tool caches,
  local receipts and private development ancestry are excluded from publication.
- Empty public repository created: https://github.com/kanoi-y/pdd-ts (immutable
  ID 1449042266). Source push and hosted verification remain next at this checkpoint.

## Remaining completion evidence

1. Finish fresh full check, clean self/example runs and sanitized initial source
   snapshot; preserve private development commits locally, publish no ancestors.
2. Observe real ordinary CI and trusted Docker/native attestation runs to terminal;
   fix any platform or packaging issues from actual logs.
3. Complete dedicated App owner consent/install, protected environment and actual
   branch/check issuer settings. The user explicitly authorized dedicated App registration as well; proceed with the stated three permissions and repository-only installation. Ask only for account-owner UI authentication if GitHub requires it.
4. Obtain genuine independent exact-head human review, not an automated owner
   review; validate the protected signed gate on the actual PR.
5. Complete the human understanding/review/maintenance study under the predeclared
   protocol, or keep those external release conditions explicitly unverified.

The implementation remains a release candidate until required external evidence
is observed. Keep the goal active; do not substitute local tests for these items.

## Hosted continuation checkpoint

- Published sanitized root `6247968` to public main; private development branch is preserved locally. Active branch is now `codex/oss-snapshot`, sharing only public ancestry.
- Ordinary hosted CI run 42354825702 passed typecheck/build, all 188 tests, PoC, three demo/self trials and four whole-flow negatives. Its final packed-install step exposed missing registry metadata in a fresh frozen-install cache. The smoke runner now primes an exact consumer lock, removes its links, then proves a fresh offline frozen install; local actual rerun passed. This does not weaken a required proof or test.
- Trusted Docker run 42355283549 failed closed with candidate evidence incomplete; no signature/passing check was produced. Add safe failure artifacts and structured status diagnostics before rerunning to obtain the actual container error.
- With explicit user permission and user-performed GitHub sudo reauthentication, created private App 5653976 and installation 179512413. UI and scoped API verified selected installation on only repository1449042266, checks-write, contents/PR/mandatory-metadata read. A temporary validation token was revoked after use; no credential contents were printed.
- App private key stored encrypted in environment `pdd-publisher`, with exactly one branch policy (main, branch type), and public variable PDD_APP_ID matches5653976. Root protected policy updated to the dedicated ID; all affected requirement revisions incremented. Actual final protected PR/human approval is still pending.
- Fresh whole suite after these changes: 188/188 plus typecheck/build. Do not infer Docker/attestation success from this local result. Finish hosted diagnostics and genuine external approval/evaluation before completing the full goal.

- Ordinary hosted CI run42356285857 is genuinely GREEN, including the corrected packed offline installation. Docker failure artifact from42356413265 identified Vite's config bundler writing under read-only node_modules. A reserved read-only cache fixture reproduced the failure; native generated-config loading, artifact-local cache and ephemeral XDG state fix it while preserving all readonly mounts. HOME is not repurposed.
- Added a fixed-main/fixed-branch Bot PR preparation workflow so the single owner can personally review an actual Bot-authored initial specification. It fetches pinned snapshots as inert data, renders a complete escaped bounded card, never executes candidate code or submits a human review. Independent review: no Important/Critical findings; focused18/18 and typecheck passed. GitHub's Actions PR-creation flag is enabled solely to permit this review-request workflow; PDD continues to reject Bot approvals.
- Registered every example source/test/proof input in self freshness, not only their wrapper imports. Added explicit runtime-boundary/assumption details to the Review Packet; a new behavioral RED showed the identity-provider premise was missing from the rendered packet before the fix. Updated Hono instructions to actual proof+24-test registration.
- Current full local check:198/198,0failed/pending, typecheck/build GREEN. Actual packed CLI offline install/help/init and both examples+self verification passed (197 cases at that earlier checkpoint; all local trials, dirty current tree, external approval pending). Full real specification card preview fits26,933bytes; final workflow will bind actual committed head. Publish the fixes and validate Docker/native signing before claiming protected readiness.
