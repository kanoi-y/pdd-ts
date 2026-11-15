# Actual PDD evidence-acceptance contract

Place these four data/test files under `validation/behavproof-probe/` in pdd-ts. Product packages remain in kanoi-y/BehavProof. The project is the actual PDD repository root; the target is its real exported `src/verification/acceptance.ts#canAcceptEvidence`, not a copied implementation or wrapper. Source config lives at `validation/behavproof-probe/behavproof.config.json` through an explicit enrolled `source.configRef`.

The64 cases enumerate every combination of completeness, scope, success, freshness, authenticity and approval. Only all-six-true may return true; the other63 cases are declared negative. The host-selected SDK Vitest executes these contracts directly without executing PDD's package build/test wrapper. Existing PDD build/proof/test checks remain separately required.

This is a basic-risk observation/enforcement experiment with explicit policy: real comparisons, per-case target calls/fault sensitivity, human Intent approval, policy and external pipeline protection are mandatory. Coverage is a warning and aggregate mutation score is off; it makes no critical coverage or aggregate mutation-quality claim and does not replace existing critical baselines.

Human approval must bind this exact proposed policy/Intent/Contract source before live enrollment. Real execution evidence is still separate from human approval and external protected-check authority. A new fault run is diagnostic evidence, never ordinary successful test evidence. Local comparison successes or a GitHub Actions job name cannot certify protection.
