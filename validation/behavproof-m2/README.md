# BehavProof

TypeScript / Node.js 24 / Vitest evidence auditing and executable contract registry. This checkout implements M1/M2 libraries and CLI; live external protection acceptance is still in progress. Nothing has been published to npm.

```sh
npm ci --ignore-scripts --cache .npm-cache
npm run build
npm test
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js init --dry-run
```

The root is a development workspace. Run project commands in a single-package target repository, or pass `--root /absolute/project`. Monorepos and non-Vitest runners are detected and reported as unsupported. `check` does not execute tests or configuration code.

```sh
behavproof check --mode audit --base origin/main --head HEAD --format json
behavproof doctor
behavproof explain changed-line-coverage
behavproof baseline create
behavproof contracts discover
behavproof contracts list
behavproof contracts validate
behavproof intent diff --base origin/main --head HEAD
behavproof impact --base origin/main --head HEAD
behavproof docs generate
behavproof docs check
behavproof docs --check
```

`init` preserves existing files, installs no dependencies and edits no workflows. Initial mode is audit. Output supports console, JSON and Markdown, with `--output relative/path`. Documents default to `.behavproof/generated/behavior.{md,html,json}`; `--output behavior.md` generates/checks one format. Generated declarations alone do not prove test execution. A baseline created in the candidate checkout is proposed data until a trusted host registers it.

Exit codes: audit normally 0 even when evidence fails; gate 0 only for a complete pass, 1 for mandatory fail/unknown, 2 for invalid configuration, malformed evidence or infrastructure errors. `doctor` returns 1 for unsupported detection and 2 for invalid configuration. Gate requires an explicit external root:

```sh
behavproof check --mode gate --trust-root /opt/behavproof/trust-root.json
```

The trusted invocation must pin that path and the verifier outside the candidate repository. A PR-owned workflow choosing its own arbitrary root is not a trust boundary. See [trust bootstrap](docs/trust-root.md) and [security assumptions](docs/security.md).

Use `@behavproof/vitest` with literal `defineContract` and `contractTest.each` declarations. Add `@behavproof/vitest/reporter` alongside Vitest's JSON reporter, and set `BEHAVPROOF_REPORT` to a fresh output path. The resulting report records registration-time bindings, case comparisons and actual suite/test inventory. Seal both reports with the explicitly invoked Collector API from `@behavproof/adapter-reports`; `check` never reruns them. See [Node service example](examples/node-api/README.md) and [Next-compatible route](examples/nextjs/README.md).

Claims remain separate: declared contracts, binding verification, executed cases, production target observations, mutation sensitivity and human approval. A fake callback can pass comparisons while production reach and sensitivity remain unknown. Global LCOV or mutation scores cannot establish individual contract claims. Optional M2-F is unsupported explicitly.

The CLI package includes versioned JSON schemas, basic/standard/critical presets and an internal audit workflow template. The template requires a pinned verifier/root deployment; it does not establish externally protected checks itself. See [acceptance status](docs/acceptance.md) and [M0 experiments](docs/m0-results.md).

Development packaging checks: `node scripts/package-smoke.mjs --online` tests a fresh consumer using registry metadata; `--offline` requires a fully seeded npm cache. Both disable lifecycle scripts and install the six local tarballs without publishing.
