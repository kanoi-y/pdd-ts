# Trusted host bootstrap

The caller owns the verifier installation and an external `trust-root.json`. Provision it in a protected CI environment or local host directory outside the entire Git checkout. Do not generate authority from PR metadata, a project JSON flag, file timestamps or a manifest's own signature. The packaged `schemas/trust-root.schema.json` defines the exact format.

Required fields:

- `schemaVersion: 1`, `policy`: protected versioned rule inventory, `config`: protected collection/discovery configuration, `baseline`: independently registered approved Registry Snapshot.
- `inputs`: protected input globs including all relevant production, tests, generated/ignored inputs and configuration; `configPaths`: exact current config files; optional `dependencyLockPath`. Use stable complete scope; input hashing does not discover omitted dependencies for you.
- `manifests`: each has `ref`, independently selected `expected` (execution ID, command hash, artifact kind/scope inventory), and `authority`. The current checked-out Git subject and config/lock hashes are computed independently before validation.

Local authority is `{kind:'local', producer:{tool,version,collectorVersion}, executionId, commandHash}` supplied by the process that explicitly selected/ran the producer. Use it for controlled local collection, not to assert remote CI authenticity. A generated manifest is not itself a trusted root. Start from the public `collect(options)` API and keep the expected execution/command/inventory in the host control plane; serialize the returned manifest separately.

CI authority is `{kind:'ci',producer,ci:{repositoryId,workflowRef,runId,runAttempt,jobId,eventName}}` and requires a `github` entry on that manifest: `repository`, `workflowPath`, `workflowSha`, `jobName`, `artifactName`, `archivePath`, `archiveEntries` (evaluated relative ref → archive entry name). Download the archive independently; the provider compares its computed SHA256 with GitHub's artifact digest. The verifier reads the archive without extracting files, rejects unsafe paths/duplicates/symlinks/oversized or unsupported entries, checks decompressed lengths and CRCs, and compares the manifest and every report with the explicit archive mapping. A downloaded archive placed beside unrelated report files is insufficient. The trusted host must still acquire the expected run/attempt/job independently and isolate the producer from publisher credentials.

Artifact kinds used by orchestration: `test`, `coverage`, `mutation`, `contract_report`, `claims`, `pipeline`. `contract_report` contains the BehavProof reporter's registration and execution arrays and runtime inventory. `claims` contains schema-validated Evidence rows; only current subject/effective-policy-bound target_observation/canary payloads are consumed. `pipeline` contains explicit `jobs` outcomes and `artifacts`. Raw report parsing does not confer authority.

Optional root `github` selects `repository`, PR number, authorized human reviewer logins and required check `{context,appId}` pairs. `GITHUB_TOKEN` is used in memory only. Targets are computed from Intent/Contract revisions and transitions, never taken from a PR body. Unchanged independently registered baseline Intent is retained; changed content/relationships require current scoped approval.

`claimScopes` independently selects contract, complete case inventory, production target and observation method. `notApplicable` exceptions select rule, permitted reason and authenticated current evidence reference; the effective protected policy must permit that exact reason. Missing or unverified exception evidence does not bypass a rule. `pipeline` selects the workflow path, gate job, complete required jobs/artifacts and protected branch; its external protection requires an authenticated CI producer plus live issuer-bound protection observation.

Changes to root, policy or baseline require the host's protected review process. No CLI command silently promotes a candidate baseline or overwrites the external root. The reference integration must also protect publisher credentials and verifier workflow source; see security.md.

## Scoped risk

Project/protected config accepts `riskOverrides: [{selector:{kind:'path',value:'src/auth/**'},profile:'critical'}]`. Selectors support `path` globs, `module` (relative module path without its TS/JS extension), and `contract-kind` (`examples`, `invariant`, `state_machine`, `api_contract`, `external`). Later matching selectors choose the requested local profile. Independently protected risk and a retained Contract's declared risk are floors. Unsupported contract kinds still produce discovery diagnostics; selecting a risk does not add an unsupported adapter.

The report retains global policy rows and adds rows scoped to each contract/explicitly selected path. Critical contracts keep mandatory approval, execution, negative-case, coverage/mutation, observation and pipeline requirements even under a basic global profile. Contract quality scope uses the independently registered `claimScopes.targetRef` production file, and individual case observations cannot be replaced by aggregate reports. Unresolved scope or absent evidence stays unknown. N/A requires the effective policy's exact permitted reason and authenticated current evidence; it cannot hide a known failure.

Local manifests additionally require `manifests[].manifestHash = hash(collectedManifest)` in the external root. Capture this from the Collector's returned object at collection time; do not compute it by rereading candidate-owned JSON when running `check`. Producer identity/execution ID alone cannot authenticate mutable local files. The expected subject/config/lock hashes stay host-selected and must also match independently computed current inputs. Rebinding an old manifest to a new current SHA does not refresh evidence.

Reviews of PR head authorize only content/transitions independently extracted from that exact immutable head tree. A tested synthetic merge may contain additional content; even correct `(base, head)` parents do not approve merge-only changes. Such targets retain baseline obligations and unknown/unapproved status until a distinct trusted approval exists.

`qualitySources` optionally selects production paths for changed-line coverage/mutation, separately from the complete hashed `inputs` (which still includes tests/configuration). It belongs only to the external host root. Every selected existing file must be covered by the input inventory; the report discloses excluded changed TS/JS paths and retains the full Git diff. Omission preserves conservative whole-project TS/JS quality scope. Changing this protected selection is a host-policy change, never a candidate-config override.

Explicit numeric parameters in the merged project/protected policy apply to scoped evaluations too. Critical risk still makes its obligations mandatory, and the stronger project/protected numerical floor wins. Preset numbers are defaults, not an extra immutable numerical floor. The already enrolled critical baseline still requires ten mutants.

See [protected producer components](protected-producer.md) for scoped probes, current-run upstream observation and the dedicated check publisher. These components require independent provisioning and do not register GitHub protection automatically.
