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

## Native signing and final review preparation

- Public main ordinary CI42359534219 and trusted Docker/signing run42359881713 completed successfully at1f476c47738612c3b2dbf3d192b7280fdd4f5de2. PR0 is explicitly a trial, not human approval or a protected PR pass.
- Native gh verification used exact workflow SAN, signer/source digest, branch and hosted-runner restrictions. Its real offset timestamp exposed a parser mismatch; the captured public verification result reproduced RED. Accepting ISO UTC offsets fixes parsing without relaxing identity/run/subject checks. Real native result now accepted; independent reviewer confirmed5/5 provenance cases and no Important/Critical findings. Public identity summary is docs/evidence/hosted-attestation.json.
- Doctor now distinguishes complete nonempty required registries, immutable repository/workflow and configuration readiness from current evidence/approval. An empty initialized project reproduced RED and now stays insufficient; independent review found no Important/Critical issue.
- Fresh full check after both fixes:200/200,19files,33.51s, typecheck/build passed. Registry includes both new cases and captured fixture input; affected requirement revisions increased.
- Remaining: publish final fixes, configure and verify strict dedicated-issuer protection, create actual Bot-authored exact-head specification PR, obtain personal human review, run its protected publisher gate, and record actual human evaluation. No human review/study result is manufactured.

## Phase3 protected-scope completion audit

- Genuine Bot-authored PR1 created at68b3fca; no human reviews existed when checked. Latest main ordinaryCI42360913756 and candidateCI42360988736 passed, including200cases. Actual packed clean-commit trials passed all200cases plus both24/34-case examples.
- Installed main protection enforces administrators, strict ordinary check15368 and protected check5653976, stale-review dismissal, code-owner review, no force pushes/deletion. Actual doctor configuration-only protectedReady=true.
- Actual unapproved PR trusted run42361441485 failed at the exact-head external human-approval check before candidate tests; signature/publisher were not reached. No protected success was invented.
- Scope audit found that the root protected snapshot contained the self gate but not both example contracts; ordinary-CI sample proofs alone do not meet the Phase3 protected approval-to-CI condition. A new actual-root snapshot regression failed because HONO-AUTH-001 was absent. Root registry now explicitly includes both complete sample requirements, targets/witnesses, source-proof obligations and runtime boundaries, including the authentic identity-provider assumption. Existing requirements have higher revisions. No contract, test or proof condition is weakened. The same immutable human review and signed protected gate can now cover all three source functions and the existing24/34 runtime cases.
- Current new registration is under local/independent review. Update the actual PR head and full immutable review card only after verification; any earlier approval must be rechecked against the new head. Human comparison/maintenance measurements remain pending.
- Fresh aggregate root CLI run satisfied all four required obligations: both sample source proofs, production gate source proof and201/201 empirical cases. Snapshot contains13requirements/11boundaries; no findings. Independent reviewer confirmed the full binding and the need to commit all four newly generated root sample model files; they are included in this change. This run is a local trial on the edited tree, not external approval or protected success.

## Japanese human-review request

- User requested Japanese PR prose. Review-card headings/instructions and future default PR title are now Japanese; exact IDs, clauses, metadata and identity checks remain unchanged. Existing review-card assertions first failed on the English output; fresh whole check passed201/201 plus typecheck/build (34.98s). Independent reviewer confirmed8/8 review-card cases and no Important/Critical issues, including the13-requirement Japanese explanation.
- The actual PR body includes a Japanese summary of each requirement, proof scope, trust premises and review decisions. Complete original specification data remains available for exact comparison. This language edit creates neither an approval nor a protected pass; human review/evaluation remain pending.

## Approved protected run and publisher recovery

- Owner User67132908 personally approved exact headbe757f1 in review5811569170. Normal CI42363201653 passed. Trusted run42364022582 then passed credential-free candidate verification (three proofs plus201cases) and structured signing. Dedicated App5653976 genuinely issued a failure check; no success was invented.
- Native gh signature verification, the strict parser, current human approval, every artifact and source-proof input hash passed separate read-only diagnostics. Independent review identified the actual publisher failure before auditCI: precreating evidence/ then exclusive recursive cp always raises ERR_FS_CP_EEXIST in Node24.14.1.
- A regression first reproduced that real failure. The publisher now restores into an absent destination without precreating it; existing evidence (including an empty directory) remains rejected. Fresh whole suite202/202,20files,34.25s plus typecheck/build passed. Independent publisher/authority review5/5 passed with no Important/Critical finding. Authentication, signature and hash policies are unchanged.
- The main publisher is self-protected by the same required check it cannot issue successfully. No protection was changed, no bypass or fabricated check was used. A narrowly scoped bootstrap exception, if approved by the owner, must retain ordinary CI and exact-head human/code-owner review, restore the original dedicated-App check immediately, and be followed by a genuine protected positive run.
- The maintainer found the Japanese PR body too difficult to understand. This is negative qualitative feedback, not evidence of reduced cognitive load; no reading time or comparison result was supplied. Future packet usability work remains required before claiming GateP3 value.
- Prepared minimal recovery commit1b162d48664622483742281b879dfed75b9aead4 directly on existing main: publisher fix, regression registration/revisions and explicit recovery runbook. Its fresh main-profile suite passed201/201 plus typecheck/build (34.37s); hosted CI42365680773 is tracked separately.
- The full repair branch incorporates that exact recovery ancestor, keeping the larger13-requirement/202-case registry and higher revisions. Fresh merged-tree check passed202/202 plus typecheck/build (37.89s). A proposed one-time owner exception would briefly disable only enforce_admins, fast-forward main to that exact recovery commit with force=false, and re-enable enforce_admins in finally; every other configured protection stays unchanged. This operation is not authorized merely by preparing it and has not been performed. The owner must explicitly allow the exception and personally reapprove the final full head first. Then the exact same head can be verified from repaired main without another validation PR.

## Confirmed protected integration and review-clarity follow-up

- Owner explicitly authorized the exact bounded recovery to1b162d4 and reviewed6416b2b. Original enforce_admins and every other protection were restored and compared. GitHub automatically dismissed approval on merge-base change; owner personally reapproved in review5811827457. No authorization remains for another exception.
- Genuine protected run42366937255 succeeded: Docker worker, three source proofs,202/202 cases, structured signing, strict native verification and dedicated-App5653976 successful check128387691700. PR1 merged under ordinary protection to4469836; post-merge CI42367339080 succeeded. Local source synced cleanly; doctor configuration ready. Historical candidate6416b2b and signer baseline1b162d4 remain distinct from squash-main4469836.
- Scope/value remains incomplete: actual readability feedback was negative; human matched-task understanding and effort measurements are not available.
- On codex/review-card-clarity, the old public review ancestry was merged without file changes to allow the fixed Bot-review branch to advance without force. Presentation refinement follows the existing Phase3 plan: decisions first, explicit added/unapproved trust premises, changed source premises and deletions visible; full exact data collapsed. Existing authority/identity rules and schemas are unchanged.
- Behavioral RED: the complete-card regression could not find the specification-change overview in the old output. The same test now also checks new boundary-only unapproved premises and source requirements in the visible overview. Fresh full check202/202 plus typecheck/build passed (33.63s). Frozen real13-requirement comparison preserved all52 data blocks; Markdown source before details changed from35,818 to440characters. This is a mechanical layout observation, not human comprehension or cognitive-load evidence.

- A separate actual empirical fixture reproduced absent required-case diagnostics (real test process completed but expected name was absent). Diagnostics now name report omissions without changing status/counts or acceptance. Separate AI review confirmed10/10 boundary cases and no Important/Critical issue; review-card8/8 likewise passed. Final combined whole check202/202 plus typecheck/build passed (35.11s). The actual two negative CLI exercises still block: missing-case output now names the absent case; new unapproved trust remains explicit; artifact links all resolve.
- One intervening local whole check correctly rejected two untracked old requirement copies. Their bytes matched historicalc710 revision1 exactly and current trackedrevision2 matched HEAD. The old copies were preserved outside the active registry in ignored quarantine; no contract, current requirement or duplicate-rejection rule was changed. This setup failure is not counted as behavioral RED.
- Final prepublication check after wording/title cleanup passed202/202,20files,35.40s with typecheck/build. Current source contract/specification definitions are unchanged; the presentation and diagnostics need fresh exact-head code review and protected CI, not a fabricated reuse of PR1's approval.

## Human-facing report repair after failed comprehension feedback

- The maintainer could not understand the manually translated evaluation reports and judged them ineffective for human review. This is actual negative qualitative feedback; no successful comprehension or time-saving result is inferred.
- The actual CLI renderer now explains authored purpose/behavior, developer-owned problems, confirmed scope and the next human action in Japanese. Complete original evidence remains in details. Fifteen requirement documents use Japanese prose while preserving IDs, contract references/semantics, risk and trust conditions; revisions increased. No runtime translation service is added.
- Eleven initial report regressions failed against the former ledger output; focused coverage grew to13 cases including local versus authenticated CI and unsafe authored content. Initial whole suite215/215 passed before the final premise fix.
- Independent review reproduced unresolved sourceRef index999 being described as confirmed despite blocked/incomplete snapshot. An actual CLI regression reproduced RED, then passed after suppressing confirmed claims for incomplete snapshots. A new bidi-display regression also reproduced RED; visible escape fixes it.
- Independent review then reproduced an unreferenced requires clause disappearing from the claimed scope in a complete clean snapshot. A real admin-only-premise proof with return passwordOk reproduced RED. The packet now carries all extracted source clauses; if any input premise lacks a bound human explanation, the developer must supply it before the proof is described as confirmed. Final checks and independent re-review remain pending.
- Final whole check after the full-source-premise fix passed216/216 across20 files, with typecheck/build (53.33s). Independent final review passed22/22 real CLI+unit cases and typecheck with no remaining Important/Critical findings. Both regenerated Japanese negative reports remain blocked, and all28 artifact links resolve. Human usefulness remains unproven; these engineering checks do not replace human feedback.

## Phase 4 continuation: read-only architecture survey

The maintainer explicitly deferred the participant trial and requested continued implementation. This permits the independent Phase 4 engineering work; it does not satisfy MVP/Gate P3 or Gate P4's human usefulness condition.

- Added `scan` for uninitialized TS/TSX projects, with in-memory AST analysis and no loading/execution of project configuration, scripts, application or tests. Inputs carry relative paths, line evidence and SHA-256 hashes. File/byte/depth/AST/fact limits and a cooperative deadline produce explicit incomplete coverage.
- Japanese Atlas includes overview, static module diagram, at most three flow proposals, authored contract/proof-target candidates and static impact references. Untrusted names stay outside Mermaid syntax; authored text is escaped. Return syntax is not claimed to establish runtime order, reachability, purity, business importance or correctness.
- Added `--previous` scan comparison and optional Review Packet update proposals. Incomplete/mismatched scopes suppress deletion inference; baseline hashes are consistency checks, not authenticated historical runs. Gate evidence/approval policy is unchanged.
- This is the first Phase 4 slice. README/tsconfig presence and package entrypoints are observed; CI definitions are hashed, not semantically interpreted. Git churn, tsconfig aliases, business domain boundaries/importance and full control-flow reconstruction remain unimplemented or unconfirmed. No invisible completion claim for §5.1.
- Registered SCAN-001 as empirical self-tests, with the four existing obligations retained. Existing thirteen root requirement revisions increased for changed test policy; the new requirement has revision 1. No formal contract or approved trust assumption was weakened.
- Actual regressions: initial CLI scan 4 RED, then GREEN; unsafe path/declaration cases 2 RED; Atlas 2 RED; package metadata, fact limit and saved comparison each reproduced RED before correction. The expression-bodied Hono handler regression also reproduced RED then GREEN. The fabricated-baseline rejection initially passed only because the old CLI rejected its flag, so it is not counted as behavioral RED.
- Whole check: typecheck/build and **229/229 tests across 21 files** passed (50.64 seconds). The actual Hono sample scan returned 3 evidence-backed proposals, 18 function declarations and complete declared coverage; all **155 files' bytes** and symlink records matched before/after. Logs and machine-specific evidence stay outside public source.
- Independent review reproduced same-line anonymous handler ID collisions, which incorrectly attributed one route’s response to another. A regression first failed, then passed after including column evidence in function IDs and synchronizing baseline validation. The reviewer independently passed all 14 scan cases and typecheck, with no remaining Important/Critical findings.
- Final whole check passed **230/230 across 21 files**, typecheck/build (55.09 seconds). Actual offline tarball install and executable help/scan/init passed; the packed CLI verified all three projects with 3 distinct source proofs and 24/34/230 test cases. These uncommitted local runs correctly remained dirty `trial` with pending approval.
- Public PR/hosted CI and genuine exact-head owner review remain the next integration steps. Participant trial files are preserved and no usability result is fabricated.
