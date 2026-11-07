# CI and approval runbook

## Authority and setup

`.pdd/config.yaml` declares the repository name, immutable numeric repository ID,
allowlisted **numeric human reviewer IDs**, minimum approvals, workflow path and
required check issuer. Read this policy from an explicitly selected committed
baseline, never from the candidate being authorized. Initial policy selection is
a human trust decision. Source contracts, every premise, requirements, obligations,
boundaries, assumptions and this configuration contribute to the spec digest.

Protect `main`: required reviews, stale-review dismissal, code-owner reviews,
strict required checks with an expected application ID, no administrator bypass,
no force pushes or deletions. CODEOWNERS routes sensitive changes to maintainers.
A check name alone is insufficient; GitHub Actions shares an application identity
across workflows, so workflow identity must additionally be verified through the
native attestation. Repository settings and allowlists require actual independent
maintainers. The author cannot approve their own PR. No review is automated on
behalf of a human.

## Exact-head review

Commit the candidate and obtain an allowlisted external human's GitHub PR review.
Then, from a clean checkout:

```sh
pdd-ts approve --pr 123 --baseline BASE_COMMIT_SHA
```

This recomputes the source spec, compares the committed baseline, requires revision
bumps for affected requirements and checks the live API. It saves only references.
Dismissal, changed head, later change request, bot, self approval, wrong repository
or wrong digest invalidate the approval. Any spec change needs a fresh exact-head
review, including deletion of obligations and changes of premises or trust policy.
No semantic implication/strengthening is inferred from a syntactic diff.

## Workflow separation

`ci.yml` is ordinary read-only build/proof/test CI. PR results are not externally
authenticated PDD approval. Checkout credentials are not persisted; project install
scripts are disabled; tools/actions/image are fixed by version and checksum/SHA.

`pdd.yml` uses an explicit dispatch on **trusted main**. It first resolves the exact
PR head and rechecks external approval. Candidate files are inspected before a
fresh checkout; symlinks/submodules are rejected. Candidate tool-path overrides,
package installs, hooks and workflow files are not executed by the trusted verifier.
It uses the baseline's installed verifier and dependencies. Empirical code executes
inside a container with no network, read-only verifier/source mounts, a non-root
UID, no capabilities, no privilege escalation, resource bounds and only specific
scratch/output mounts. The worker has no write permission, secrets or OIDC authority.

A separate signer job receives only structured bytes and attests their digest.
It never checks out or executes the candidate. The report binds the **candidate**
commit separately from the baseline/workflow commit; GitHub's source certificate
for a dispatch describes trusted main, not the candidate. Dispatch with PR `0`
creates a main-branch **trial**, without asserting human approval.

Test code, expected cases, validators and runtime behavior remain an explicit
reviewed test-harness trust boundary. A signed test report is not a mathematical
proof of runtime behavior or an adversarially sound JS test sandbox. Container
isolation protects verifier files and credentials; it does not make test assertions
or the container runtime infallible.

## Verify downloaded evidence

Download the attested report and the associated `.pdd/evidence` artifacts from the
same verifier run into the candidate checkout's ignored `.pdd/evidence/` directory.
Use the same trusted pdd-ts build, Node and proof tools as the producing run. Do not
replace tracked source/metadata with artifact-provided files. Refresh local source
proof files from the committed candidate, then run:

```sh
pdd-ts audit --ci --pr 123 --baseline BASE_COMMIT_SHA \
  --attestation .pdd/evidence/attested-evidence.json --json
```

This runs fixed `gh attestation verify` arguments with the exact certificate SAN,
signer/source commit and branch, GitHub-hosted runner restriction and SLSA predicate.
It also checks numeric repository identity, signed subject bytes, verified timestamps,
run/attempt, exact candidate, live human reviews, protected baseline, all current
inputs and artifact hashes. Receipt JSON and public run metadata cannot authenticate
themselves. Missing artifacts, unsupported verification or unavailable API fail closed.
Run `audit --ci` as a required gate in an independently protected publisher workflow;
never give its write/signing credentials to a candidate execution job. This MVP does
not auto-post PR comments or automatically merge a PR.

`doctor --json` distinguishes unconfigured/insufficient protection from unavailable
API checks. `protectedReady` describes configuration only: the registry, clean source, toolchain,
immutable repository, active trusted workflow, dedicated issuer, review rules and
protected environment must be confirmed. Fresh evidence, native signatures and
actual human approval are checked separately for each protected gate.
The initial single-maintainer repository cannot claim independent review readiness.

Native verification currently targets GitHub CLI 2.97.0's JSON shape; incompatible
versions are rejected rather than silently treated as verified. Archive the original
file, native verification JSON, attestation bundle and trusted-root material for
historical/offline verification. Offline roots do not reveal later revocations.

Sources checked 2026-11-07: [GitHub CLI attestation verification](https://cli.github.com/manual/gh_attestation_verify),
[review REST API](https://docs.github.com/en/rest/pulls/reviews),
[GitHub security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

## Dedicated publisher App (required for protected use)

The publisher must use a **separate GitHub App**, not the shared Actions App
(ID 15368). A PR can create an Actions job with the reserved check name; Actions
then emits a check with that shared issuer even without `checks: write`.
Both doctor and publisher reject the shared issuer. Missing App configuration
keeps protected use disabled; ordinary trial CI remains available.

The reviewable [App manifest](../../templates/github-app-manifest.json) requests
only checks-write, contents-read and pull-requests-read, with
no webhooks or events. Register the private App in the owning account and install
it on this repository only. Put its numeric ID into trusted `github.checkAppId`.
In the `pdd-publisher` **environment**, set variable `PDD_APP_ID` and secret
`PDD_APP_PRIVATE_KEY`. Do not use a repository-wide private-key secret: a same-repo
PR workflow could reference it. Restrict environment branch policies to the exact
`main` branch only, with no tags/wildcards; doctor checks that restriction and
credential-name availability. The public key/ID is not a secret; never paste the
private key in chat, source, logs or artifacts.

The pinned official create-App-token action creates a short-lived installation
token only in this protected publisher job. The publisher verifies the actual
check response's App ID against the protected baseline. Required branch checks
must name this dedicated ID. App registration/installation is an account-owner
consent step; no app, key or human review is fabricated by local fixtures.

See [GitHub's manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
and [environment isolation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

The read-only Actions token is used only for native attestation downloads; the dedicated App token alone publishes the protected check. Candidate processes inherit neither credential.
