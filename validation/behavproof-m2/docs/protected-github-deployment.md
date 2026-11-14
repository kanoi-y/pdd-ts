# pdd-ts protected GitHub deployment proposal

Status: reviewable implementation, not deployed. Existing main protection and `pdd-publisher` restrictions have not been changed. Actual library/build/package/probe validation passed on Windows, macOS and Linux at `16164ab99f587c8791d50f917897da967ad8cc3d`, run43577566086, including the Linux container scenarios. Later controller/template changes require their own final CI and review.

## Files and trust path

The sanitized validation payload adds `.github/workflows/behavproof-producer.yml` and `.github/workflows/behavproof-publisher.yml` from `templates/protected-github-*.yml`. Both are dispatch-only. Source executes only from registered main workflows; the existing `pdd-publisher` environment remains main-only. No candidate workflow receives the App key. The SDK is checked out at an operator-pinned full commit, built with lifecycle scripts disabled, and matched to that commit before control-plane work.

1. `github-produce.mjs` obtains the current isolated-base PR, exact live producer job identity, and a raw Git blob materialization of every project file at the actual PR head. It rejects checkout attributes/filters, symlinks/submodules, reserved `.git`/`.behavproof`/`node_modules`, excessive inputs and case collisions. Fetch/index/HEAD retain the real commit. Generated host config is separately hashed. It retains the candidate's actual profile, risk selectors, rule and contract-source settings, overriding only the independently selected base and test-report location. The protected config remains the enrolled baseline, so a candidate weakening is explicitly rejected while protected floors stay in force. The enrolled project policy file must retain its exact approved source hash; a change requires a new approved enrollment.
2. A separately staged private public SDK and candidate/control source are read-only mounts. The test container runs non-root, no network, no capabilities, fresh output, tmpfs/home, resource/time limits. Only its exact Git root gets an ownership exception. Docker cleanup must be confirmed. Collector manifest and host-owned context are written after the container is gone; only explicit sealed report bytes are copied, never an output-directory tree.
3. `github-verify.mjs` verifies the completed registered workflow/run/latest attempt/job, unique artifact and independently downloaded archive digest before trusting context. ZIP parsing is bounded and in memory, with no extraction. It fetches current raw source again, compares complete inputs/config/subject/obligations, and restores only explicit selected report bytes. The upstream `verify` job does this without executing candidate code.
4. The separate `gate` job uses `if: always()`, repeats current authentication, and invokes the actual built `behavproof check --mode gate`. It verifies live completed upstream jobs while the gate itself is still running, pinned workflow bytes and issuer-bound protection. The fixed CLI command is unconditional.
5. `github-publish.mjs` re-evaluates with the protected SDK, compares the captured CLI report and complete obligation inventory, then uses `GitHubCheckPublisher`. Missing producer/preparation/report/upstream evidence has an explicit failure-only path; it invents no subject/producer. Only success/failure is published with fixed text. Repository/PR current head/base and returned App identity are checked again.

A protected producer is an integration trust boundary, not proof against arbitrary JavaScript forging metadata in its own process. The scoped probe limitations in `protected-producer.md` still apply. Installed SDK dependencies must be a clean trusted/public installation from the protected lock; staging does not scrub arbitrary files hidden inside an allowed dependency.

## Exact provisioned identities

| Setting | Proposed value |
| --- | --- |
| Repository | `kanoi-y/pdd-ts`, ID `1449042266` |
| Required context | `BehavProof protected gate` |
| Expected App | `5653976` (`pdd-ts-evidence-kanoi-y`) |
| Test base | New `behavproof-enforcement-test` branch |
| Publisher environment | Existing `pdd-publisher`; keep main-only branch policy |
| Producer | `.github/workflows/behavproof-producer.yml`, job `collect` |
| Publisher | `.github/workflows/behavproof-publisher.yml`, upstream `verify`, final `gate` |
| Runtime | `node:24.14.1-bookworm@sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec`, linux/amd64 |

Use App Checks write, Contents read, Pull requests read, Actions read, Administration read and implicit Metadata read. The existing fixture showed no Actions/Administration grants, so those two read grants must be confirmed/provisioned before deployment. Never read or copy the private key. The token remains in the protected host; neither it nor its key enters the container.

Four non-secret repository variables are controlled by an administrator and never loaded from a PR file:

- `BEHAVPROOF_SDK_SHA`: final fully verified implementation commit in this repository.
- `BEHAVPROOF_WORKFLOW_SHA`: the exact main commit containing the reviewed workflow files. Set after the approved main merge; an unregistered later main revision fails closed until reviewed/re-registered.
- `BEHAVPROOF_REGISTRATION_JSON`: immutable output of `enroll-enforcement-probe.mjs`, from actual same-head human review of the isolated probe's policy/Intent/Contract.
- `BEHAVPROOF_REGISTRATION_DIGEST`: the independent digest returned by that enrollment.

The JSON is public policy/approval/snapshot data, not a secret. Its authority comes from the protected admin variable, not the serialized approval status. Main retains both existing PDD required checks, strict/admin protection, and existing review requirements. Any main merge must satisfy those checks and human review; the implementation does not bypass them.

## Separate positive control and execution sequence

`examples/enforcement-probe` is a separate basic-risk toy with an explicit proposed policy. Real tests, contracts, negative cases, per-case target observation/canary, human Intent approval, pipeline and policy protection are errors; coverage is a warning and aggregate mutation score is off. The critical Node API policy/approved registration remains unchanged, including minMutants10. A successful toy gate makes no critical coverage or aggregate mutation-quality claim.

After actual same-head human approval of the final review PR, `node scripts/enroll-enforcement-probe.mjs --pr <review-pr> --directory <external-private-directory>` obtains immutable source and verifies Policy/Intent/Contract approval through current GitHub protection and reviewer APIs. It writes a digest-addressed private snapshot; it does not set variables or merge. After the approved main integration and variable/App setup, use a new isolated test base and Bot-authored probe PRs. Apply strict, admin-enforced protection with only `{context: "BehavProof protected gate", app_id: 5653976}` to this new base. Do not add unrelated required checks/reviews to this test base, so the negative result can be attributed to the dedicated context. Main review protection remains the authority for initial policy enrollment.

Actual required external evidence, each on a fresh PR head:

1. Normal current real collection → completed registered producer → successful upstream verification → actual SDK gate and dedicated App success → merge eligibility attributable to that context.
2. Dispatch publisher with `skip_verify: true` → upstream skipped → final gate actually runs → dedicated App failure, merge blocked (AC-18).
3. Do not run the registered publisher on a fresh head (the deleted final-gate case) → required App context absent → merge blocked. A same-name Actions job's skip/success must not satisfy it.
4. Publish the same-name success from GitHub Actions App15368 on another fresh head → required App5653976 context unsatisfied → merge blocked (AC-50).
5. Change the protected probe Intent without human review → real collection and protected gate reject its transition (AC-22). A proposed policy weakening remains blocked and cannot replace the admin snapshot; a newly approved replacement requires fresh enrollment.

Record actual API/check/job/merge-state responses and archive byte hashes. Do not substitute a local fixture, existing PDD check, or merely present workflow file for these results. Do not merge the disposable negative-test PRs.
