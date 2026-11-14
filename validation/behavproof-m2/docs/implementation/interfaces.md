# Shared package interfaces

`@behavproof/core` is ESM on Node 24.x. Its authoritative runtime schemas and inferred types live in `packages/core/src/schemas.ts`; built declarations in `packages/core/dist/*.d.ts` provide exact structural definitions. Later packages must import these types rather than invent another evidence representation. All persisted top-level schemas are strict and versioned `schemaVersion: 1`; profile defaults are pinned at `profileVersion: '1'`.

## Public exports

Types: `EvidenceStatus`, `Severity`, `Risk`, `Mode`, `RulePolicy`, `Policy`, `Config`, `EvidenceSubject`, `ExecutionManifest`, `Intent`, `ContractCase`, `Contract`, `RegistrySnapshot`, `Approval`, `Evaluation`, `Provenance`, `Evidence`, `CheckReport`, `ManifestExpected`, `ProducerAuthority`, `ManifestValidation`.

Runtime schemas: `EvidenceStatusSchema`, `SeveritySchema`, `RiskSchema`, `ModeSchema`, `HashSchema`, `CountSchema`, `RelativePathSchema`, `RulePolicySchema`, `RuleIdSchema`, `RulesSchema`, `PolicySchema`, `ConfigSchema`, `EvidenceSubjectSchema`, `ProducerSchema`, `CiIdentitySchema`, `ExecutionManifestSchema`, `IntentSchema`, `ContractCaseSchema`, `ContractSchema`, `RegistrySnapshotSchema`, `ApprovalSchema`, `EvaluationSchema`, `ProvenanceSchema`, `EvidenceSchema`, `CheckReportSchema`, `ManifestExpectedSchema`, `ProducerAuthoritySchema`.

```ts
parseConfig(value: unknown): Config;
parseEvidence(value: unknown): Evidence;
canonicalJson(value: unknown): string;
hash(value: unknown): string;
hashBytes(bytes: Uint8Array): string;
safeRead(root: string, path: string, maxBytes?: number): Promise<Buffer>;
safeReadJson(root: string, path: string, maxBytes?: number): Promise<unknown>;
validateManifest(
  manifest: unknown,
  expected: ManifestExpected,
  artifacts: Readonly<Record<string, Uint8Array>>,
  authority: ProducerAuthority | undefined,
): ManifestValidation;
evaluateGate(evaluations: readonly Evaluation[], mode: Mode): CheckReport;
evaluateThreshold(ruleId: string, value: number | undefined, policy: RulePolicy,
  evidenceIds?: string[], scope?: string[]): Evaluation;
mergeProtectedPolicy(project: Policy, protectedPolicy: Policy): Policy;
mergeEvidence(evidence: readonly Evidence[]): Evidence[];
getProfilePolicy(profile: Risk, profileVersion?: '1'): Policy;
```

`DEFAULT_MAX_BYTES` is 10 MiB. Paths are nonempty scoped relative POSIX paths; traversal, absolute paths, Windows separators, symlink components, nonregular files, oversized files, and observed concurrent file changes are rejected. Invalid input throws; CLI callers map malformed config/report/infrastructure errors to exit 2. Scoped reads are not an OS sandbox against a hostile process concurrently replacing directory ancestors.

`ManifestExpected` requires `executionId`, `subject`, `commandHash`, `configHashes`, and `artifacts: {ref,kind,scope}[]`, with optional `dependencyLockHash`. `ProducerAuthority` is either `{kind:'ci', producer, ci}` or `{kind:'local', producer, executionId, commandHash}`. `producer` matches the manifest producer schema; `ci` includes repository/workflow/run/attempt/job/event identity. `ManifestValidation` contains `artifactIntegrity`, `producerTrust`, `subjectMatch`, `executionStatus`, and sorted `reasons`.

`Policy` contains `{schemaVersion:1, profileVersion:'1', rules:Record<string,RulePolicy>}`. `RulePolicy` contains `severity` and optional percentage `min`, integer `minMutants`, and `allowNotApplicable:string[]`. `Evaluation` follows spec §11 plus optional `notApplicable:{reason,allowedReasons,evidenceIds}`. Hosts derive permitted reasons from the effective protected policy and verify referenced scope evidence. An unpermitted or unsupported N/A cannot satisfy a mandatory rule.

`CheckReport` contains `schemaVersion`, `mode`, `status:'pass'|'fail'|'incomplete'`, `exitCode:0|1|2`, `mandatoryCount`, sorted `evaluations`, and sorted `reasons`. Pure gate evaluation emits exit 0 for audit, and exit 1 for blocked gate. It rejects conflicting rule/scope evaluations and blocks zero mandatory rules. Config/IO errors are exceptions, not synthetic successful audit results.

Evidence payloads are discriminated by kind: test counts; coverage covered/total/excluded/unobserved counts; mutation killed/survived/noCoverage/timeout/excluded/unobserved counts; pipeline checks; contract revision/binding/case comparison; approval; execution manifest; scoped target observations; scoped canary detections. Optional M2-F kinds accept only explicit unknown/unsupported payloads. Passing contract comparisons and observations require positive counts. `mergeEvidence` rejects conflicting records with the same evidence ID.

## Caller trust boundary

The caller supplies `expected` and `authority` from an independently trusted control plane. Never copy authority from the untrusted manifest/report/project configuration. Hashes establish identity; timestamps, self-declared names, attestation references, serialized provenance statuses, and signatures alone confer no producer authority. `parseEvidence` validates structure and preserves claims; it does not authenticate them. Recompute provenance with external expectations before admitting evidence into mandatory evaluations. Missing manifests remain unknown. Dirty inputs fail subject matching; audit may still display their contents. Failed producer execution stays failed despite matching artifacts.

A gate requires an externally registered trust root; absence is a configuration error (exit 2) in the CLI orchestration layer. Approval and protected policy are separate externally obtained inputs; the core never interprets an approved boolean in a report as authority. Contract comparisons establish binding and execution, not production reach or mutation sensitivity.

## Explicit adapter SDK

Types: `AdapterFormat`, `DetectContext`, `DetectionResult`, `CollectContext`, `DiscoverContext`, `ContractExecutionEvidence`, `BindingContext`, `BehavProofAdapter`, `ContractSourceAdapter` (see `packages/core/src/sdk.ts` / built declaration).

```ts
interface BehavProofAdapter {
  readonly id: string;
  readonly apiVersion: 1;
  detect(ctx: DetectContext): Promise<DetectionResult>;
  collect(ctx: CollectContext): Promise<Evidence[]>;
}
interface ContractSourceAdapter {
  readonly id: string;
  readonly apiVersion: 1;
  discover(ctx: DiscoverContext): Promise<Contract[]>;
  bindExecution(ctx: BindingContext): Promise<ContractExecutionEvidence[]>;
}
```

Contexts provide explicit inventories and bounded read functions; no command executor or automatic plugin loader is supplied. Hosts explicitly select supported adapters. Core discovery never imports repository test/config code.

## Profile policy version 1

`getProfilePolicy(profile, '1')` returns an independent policy snapshot. `ConfigSchema` / `parseConfig` apply the selected profile's defaults, then merge individual project rule fields; a partial `rules` object does not delete other preset rules. Numeric thresholds remain explicitly configurable. Protected policy merging enforces externally registered numerical floors. These preset numbers are initial examples, not universal quality guarantees.

| Rule | basic | standard | critical |
| --- | --- | --- | --- |
| testResult | error | error | error |
| changedLineCoverage | warn, min 80 | warn, min 80 | error, min 80 |
| mutationScore | off, min 70, minMutants 10 | warn, min 70, minMutants 10 | error, min 70, minMutants 10 |
| pipelineIntegrity | warn | warn | error |
| intentApproval | absent | absent | error |
| negativeCases | absent | absent | error |
| contractExecution | absent | absent | error |
| policyProtection | absent | absent | error |
| productionTargetObserved | absent | absent | error |
| mutationSensitivityObserved | absent | absent | error |

Critical preset severities remain mandatory even if project overrides request `off` or `warn`. Critical does not automatically enable contract collection: `contracts.enabled` retains its explicit/default value. Disabling collection leaves critical contract obligations required; it must produce unknown for unavailable checks, never omit or pass them. Downstream orchestration must evaluate **every rule in the effective policy inventory**, emitting unknown when an evaluator, scope, evidence, or external protection is unavailable. A profile string alone establishes no evidence claim.

`RuleIdSchema` and `RulesSchema` reject `prototype` and own names of `Object.prototype` (including `__proto__`, `constructor`, and `toString`). Rule maps are checked before record normalization so reserved JSON keys cannot silently disappear. Both project and protected `PolicySchema` inputs and config rules use this boundary.

## Report adapter and explicit collector

`@behavproof/adapter-reports` exports the following (see built declarations for exact structural result types):

```ts
normalizeVitest(value: unknown, inventory?: VitestInventory): { payload: {total:number;passed:number;failed:number;skipped:number}; status: EvidenceStatus };
normalizeLcov(input: string): CoverageReport;
evaluateCoverage(report: CoverageReport, scope: Scope, min: number, nonExecutable?: Scope, mappingVerified?: boolean): {status:EvidenceStatus;payload:{covered:number;total:number;excluded:number;unobserved:number};score:number|undefined};
normalizeStryker(value: unknown): MutationReport;
evaluateMutation(report: MutationReport, scope: Scope, min: number, minMutants: number, sources?: Readonly<Record<string,string>>, mappingVerified?: boolean): {status:EvidenceStatus;payload:{killed:number;survived:number;noCoverage:number;timeout:number;excluded:number;unobserved:number};score:number|undefined};
sourceTreeHash(root: string, paths: readonly string[]): Promise<string>;
gitDiff(root: string, base: string, head: string): Promise<GitDiff>;
gitSubject(root: string, inputPaths: readonly string[], prHead?: string, base?: string): Promise<EvidenceSubject>;
lineMapping(root: string, prHead: string, testedCommit: string, paths: readonly string[]): Promise<'known'|'unknown'>;
detectProject(root: string): Promise<{support:'single-package'|'monorepo'|'unsupported'; evidence:string[]; reasons:string[]}>;
collect(options: CollectOptions): Promise<ExecutionManifest>;
```

`VitestInventory` is `{suiteCount:number; testCount:number; files:readonly string[]}`. `Scope` maps scoped relative POSIX paths to changed line numbers. `CoverageReport` maps such paths and lines to hit counts. Missing records or changed lines count as unobserved; a caller may supply independently verified non-executable lines as exclusions. A zero denominator remains unknown. `mappingVerified` defaults to false and must be true only with independently established report/source line correspondence, including source maps and merge-commit correspondence. `lineMapping` establishes only whole-file Git blob equality between two fixed commits; it does not validate source maps. Binary diff entries have `ambiguous:true`; missing merge-base gives `status:'unknown'`. Deleted files have no new lines and are not automatically a not-applicable decision. Paths outside the validated relative form, invalid counts, and unsupported report formats throw.

Vitest checks internally consistent suite-summary counts, ensures reported file records do not exceed the suite total, and checks test counts against individual assertion statuses; declared suite failures fail; failed suites or `success:false` fail, while zero or skipped tests are unknown. Mutation scores use `(Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage) * 100`; CompileError and Ignored are disclosed exclusions, RuntimeError and Pending are unobserved, and unknown statuses are invalid. Zero or fewer than `minMutants` scored mutants and missing scoped files are unknown. Each Stryker file retains its reported source; every scoped file requires exact equality with independently supplied evaluated source and `mappingVerified: true`, otherwise the result is unknown. That flag must reflect independent line-mapping verification, including source maps; matching content does not establish provenance. Appropriateness of exclusions is a caller responsibility. Vitest JSON does not uniquely identify repeated or empty suites. If suite totals and flat file records do not establish an unambiguous flat observation, the result is unknown unless a caller-supplied inventory exactly matches the suite count, test count and file identities; an inconsistent supplied inventory also yields unknown. The inventory must be obtained and authenticated independently through a trusted execution/reporting path, never inferred from the report or a project `complete:true` flag. Even a flat passing observation does not authenticate the report or establish expected test scope; the CLI must verify completeness, scope and provenance independently before treating it as gate evidence. These raw statuses are content observations, never producer authority or evidence freshness. Callers must apply core manifest validation and protected policy before using them as gate evidence.

`CollectOptions` contains `root`, `executionId`, `command`, argument array `args`, explicit `inputPaths`, `configPaths`, existing `outputRoot`, expected `artifacts: {ref,kind,scope}[]`, and `producer`; optional `dependencyLockPath`, `ci`, `prHead`, `base`, and `timeoutMs`. The caller must enumerate all meaningful source, test, config, generated and ignored inputs. A fresh output directory is created as `<outputRoot>/<executionId>` and its absolute path is passed as `BEHAVPROOF_OUTPUT_DIR`; artifacts must be written there. Execution ID reuse fails, nonzero/signal/timeout seals no artifacts, input/config/lock changes reject the result, and timeout defaults to 10 minutes with a one-hour maximum. `collect` runs only the explicitly supplied executable and argument array, without a shell. Discovery and report evaluation do not execute project commands or import project configuration. Detection requires a bounded, scoped package manifest, Git, a declared Vitest dependency, and a test script exactly `vitest` or `vitest run` (allowing surrounding/inter-token whitespace); all other scripts, including missing or complex wrappers, are unverified/unsupported, and reports workspace markers and reasons explicitly. Git disables external diff, text conversion and fsmonitor hooks during analysis. CI identity, tool versions, scope, and the executable selection are caller assertions requiring independent authority. This wrapper is not a sandbox: it cannot prove the absence of transient input changes or prevent a runner/descendant from writing elsewhere. Run it in an appropriately isolated trusted execution environment; `check` must never invoke it implicitly.

## Contract registry and Vitest integration (Task 3)

`@behavproof/contract-registry` exports `discover`, `discoverSources`, `snapshot`, `reconcile`, `transitionHash`, `lifecycle`, `lifecycleTransitionHash`, `buildEvidenceGraph`, `bindingKey`, `bindRegistrations`, `evaluateAssurance`, `evaluateScopedClaims`, `renderDocuments`, `checkDocuments`, and `analyzeImpact`; built declarations define exact types. `EXTRACTOR_VERSION` is `1`. Inputs are explicit in-memory data; discovery does not run or import them. Inline extraction recognizes named official imports and top-level direct `defineContract` JSON-compatible literals; common indirect, namespace and dynamic official imports diagnose unknown. JSON manifests accept one literal contract; other kinds are explicitly unsupported. Duplicate contract/case IDs are errors. Snapshot includes extractor version and scope; callers must obtain the baseline through a protected source. Revision hashes exclude paths.

`reconcile` preserves prior obligations unless `verifyApproval` validates a structurally valid approval targeting `transitionHash(old, newOrUndefined)`. `lifecycle` starts proposed; an externally verified approval of the current content hash moves it to approved, and externally verified transition hashes permit superseded or revoked states. Transitions are explicitly ordered inputs; a record's own status is not authority. Changed unsupported semantic kinds diagnose `UNSUPPORTED_SEMANTIC_DIFF`. `buildEvidenceGraph` emits typed intent→contract, contract→case, case→execution, execution→rule, and approval edges. Execution and approval edges require external verifier callbacks, current revision/target hashes, and expected binding identities; malformed, stale, duplicate, or unverified evidence is unknown. Approval verification, snapshot protection, provenance, and freshness are caller responsibilities. Relation edges indicate declared relationships, not intent completeness or production reach.

`evaluateAssurance(contracts, rows, expectedBindings, verifyEvidence)` and `evaluateScopedClaims(contract, scope, observations, canaries, rows, expectedBindings, verifyEvidence)` default to unknown without independent verification. A negative-case pass requires a declared negative case and matching active revision/binding/execution. Production-target and canary claims require separate scoped observations matching contract, cases, target and method; comparison metadata alone cannot satisfy them. `bindingKey(contractId,caseId)` returns a collision-free canonical JSON tuple key.

`renderDocuments(data, execution, options)` emits deterministic Markdown, HTML and JSON, escaping untrusted Markdown/HTML. It includes declaration origins and scoped execution/approval evidence with effective unknown status unless the supplied verifiers, current hashes and expected bindings match. `checkDocuments` detects edited output. `analyzeImpact` follows literal relative imports, re-exports, require and dynamic import paths in reverse plus explicit file-to-contract mappings; unresolved external/dynamic dependencies and indirect/member calls remain unknown. Static call facts are included, but it does not claim a complete symbol-level call graph or behavioral equivalence.

`@behavproof/vitest` exports the literal `defineContract` and `contractTest.each` API. The reporter (`@behavproof/vitest/reporter`) writes to explicit `BEHAVPROOF_REPORT`. It snapshots registration metadata in `onTestModuleCollected` before callbacks execute and separately writes end-of-run comparison rows and actual suite/test/module inventory, including skips. `bindRegistrations(registrations, rows, verifyReport)` accepts only an authenticated current-run artifact: it rejects duplicates, inconsistent IDs/revisions/hashes and non-registration metadata, returning expected binding hashes keyed by `bindingKey`. The caller must authenticate the reporter artifact and Vitest JSON under the same Collector execution and verify the tested subject/current inputs before providing `verifyReport`; merely copying hashes from end rows or project config is not authority. This assumes the observed runner/reporter is a trusted producer for that execution, and is not a sandbox against arbitrary hostile test code. Reporter inventory works without contracts and may be passed to `normalizeVitest` only after the same authentication. Runtime callback hashes use transformed function strings, not AST hashes. Comparison success proves neither production reach nor canary sensitivity.

### Task 3 review corrections

`snapshot` persists `discoveryDiagnostics` (including unsupported kinds) in the core `RegistrySnapshot`; callers must still independently authenticate the snapshot and scope. `evaluateAssurance(snapshot, ...)` can pass only when diagnostics are present and empty. A legacy contract array or a snapshot without diagnostics cannot establish complete discovery and therefore yields unknown for positive completeness claims.

Registration and execution bindings are per execution identity: `bindingKey(contractId, caseId, testId)` uses a canonical JSON triple, and `bindRegistrations` allows distinct test IDs for the same case while rejecting repeated test IDs. It retains the two-part key only when exactly one registration exists for that case for compatibility with manually supplied rows without a test ID. All verified current executions for a required case must pass; any verified failure fails, while duplicate identities and missing bindings remain unknown. The helper captures a deep isolated contract copy before hashing/registering and passes each callback a separate copy, so mutation after registration or inside a callback cannot alter the compared expectation.

`reconcile` independently returns `intentObligations` as well as contract `obligations`. `intentTransitionHash(oldIntent, newIntentOrUndefined, oldContractIds, newContractIds)` binds both content and many-to-many relationships; only a verified approval scoped to that Intent and transition may supersede its old obligation. Contract transition approval does not approve the Intent. Intent removal, relationship removal, and independent content changes are reported even if contract revision hashes are unchanged.

`evaluateScopedClaims` requires each case to have a separately attributed singleton-case observation/canary before returning a pass for a multi-case scope. Aggregate rows spanning several cases do not prove individual case coverage. Scope must match the contract and its case inventory; verified failures take precedence over passes, including for negative-case execution.

### Task 3 review round 2 corrections

`reconcile` now preserves the old executable contract obligation, including its old Intent relationship, whenever removing that relationship lacks a separately verified Intent transition approval. This holds even if the contract deletion or replacement itself has been approved. Once both relevant transitions are approved, the new active obligations apply. Callers must use the returned contract `obligations` and `intentObligations` together with the effective protected policy; diagnostics alone are not the obligation inventory.

For each required negative case, `evaluateScopedClaims` compares every externally authenticated expected binding identity against all verified current rows. A pass requires every registered identity to have one matching passing comparison. Missing, skipped, unknown, mismatched, or duplicate executions remain unknown; any verified failure remains fail. The two-part key remains supported only when there are no per-test triple keys for that case.

## GitHub authority

`@behavproof/adapter-github` exports `GitHubAuthority({repository, token?, fetcher?, timeoutMs?, maxBytes?, maxPages?})`. `approval(pr, target, expectations)` checks current head/base, protected review requirements, authorized non-self humans, dismissal/latest decisive states, pagination and optional current CODEOWNERS decision. `producer(ci, expectations)` checks independently pinned workflow source, successful run/attempt/job and archive digest/name. Caller computes the archive digest independently and must enforce trusted job isolation (see security.md). Both return pass/unknown observations with snapshot hashes; no repository claim establishes authority. `evaluateUpstream` checks explicit complete job/artifact inventory. `diagnoseWorkflow` returns separate internal-definition and external-protection results; static diagnosis alone never passes external protection.

## CLI integration

`@behavproof/cli` exports `check(root, options)`, `TrustRootSchema`, `loadTrust`, `registry`, `writeScoped`; the binary is `behavproof`. Strict JSON project config, external host-selected roots, all effective rule IDs and separate unknown/fail/infrastructure exits are enforced. Unknown configured evaluators remain unknown rather than disappear. Schemas and versioned presets are packaged by `scripts/build-artifacts.mjs`. `verifyArtifactArchive` authenticates evaluated manifest/report bytes against a separately digest-verified ZIP without extracting files, with bounded entry/payload checks.

`gitSubject` now includes `testedCommitParents` for a distinct tested merge. `verifyMergeSubject` reads actual Git parents and requires the pinned base/head pair; metadata alone cannot establish that relationship. Line mapping remains independently verified per scoped file. Merge relationships that cannot be established stay unknown.

## Protected baseline enrollment

`@behavproof/cli/api` exports `RegistrationSchema`, `createRegistration`, `persistRegistration`, and `loadRegistration`. A registration binds the repository ID/name, exact approved PR source, source-file hashes, policy, config, complete registry snapshot, input scope and required observation protocol. `createRegistration(value, authority)` accepts only strict synchronous `true` from independent source and human-approval verifiers for every policy/Intent/Contract target. It clones and freezes input before callbacks; serialized status fields grant no authority.

Persistence accepts only an opaque verified handle and an existing owner-private directory outside the entire Git checkout. Files are immutable and digest-addressed; an existing file must have identical bytes. `loadRegistration(projectRoot, path, expectedDigest)` verifies the schema and an independently supplied protected digest. POSIX directory ownership/mode is checked; a Windows host must independently provision private ACLs. The baseline authenticates approved obligations, not future execution, production reach, CI authority or required-check enforcement. `scripts/enroll-approved-baseline.mjs` demonstrates enrollment from actual immutable GitHub source and current human review; it makes no branch-protection changes.

## Scoped producer and publication components

Registry additionally exports `instrumentFunction`, `evaluateProbeRuns`, `PROBE_METHOD` and `ProbeProtocol`, `ProbeRun`, `ProbeRow`, `TargetFault`. Vitest's `./probe` export provides target-call capture; raw rows remain untrusted. CLI enrollment additionally exports `registrationProjectData`, preserving approved hashes/commit through a selected subtree projection. GitHub exports `prepareCheckPublication`, `GitHubCheckPublisher`, `PublicationPacket`, `PublicationExpectation`, `PreparedCheck`, plus `GitHubAuthority.upstream` for a running final gate's completed prerequisites. The precise protocol, source/hash and callback assumptions are documented in `docs/protected-producer.md`; none of these APIs implicitly register a producer or change repository protection.
