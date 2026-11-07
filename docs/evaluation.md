# MVP evaluation protocol

## Before trial

Compare three conditions on matched tasks: existing test-only workflow; direct LemmaScript / Dafny; pdd-ts with the same verifier plus obligations, external approval and report. Start with auth to smoke-test plumbing, then a branch-based bigint split with nonnegative shares and conservation of total.

Acceptance conditions set before measurements:

- All mandatory negative fixtures must block; no missing/zero/skipped/stale/wrong-source evidence may be reported as a satisfied required item.
- A reader must correctly identify proof scope, unverified boundaries, newly added assumptions and pending approvals from each report.
- Measure setup, spec writing, proof assistance, update/repair and ongoing maintenance separately from machine verification time.
- Direct-tools vs pdd-ts must use the same source, property set, tool versions and fault scenarios. Counterbalance task order for human trials.
- Record number of manual commands/locations needed to find evidence, clarification count, interruptions, review time and detected/missed injected faults. A shorter report is not automatically better.

## Evidence so far

`docs/evidence/p0-results.json` records real machine results, not human review times. Phase 0 demonstrates real proof and mutations, vacuous proof and audit findings; it does not establish product usability or translation soundness.

## Release validation and external follow-up

- A clearly labeled reproducible Hono sample for staged adoption; the user has no existing project to supply.
- Real GitHub repository, protected baseline, external human spec review, and hosted CI result bound to the tested source.
- Human evaluation of report understanding and judgment/evidence-tracing load against direct tools.

These are explicit external evidence needs. Local demos, API fixtures and command timing must not be substituted for them or labeled as successful user studies.

## Reproducible machine comparison

Run `pnpm build && node scripts/compare.mjs`. The output in
`docs/evidence/machine-comparison.json` measures the same auth/split sources,
contracts, pinned proof tools and 24/34 empirical cases. Direct mode uses upstream
extract, typed info, generation, audit, verification and Vitest; pdd-ts additionally
checks profile, witnesses, required obligations, fingerprints and produces a packet.
There is one observation per fixture, with order counterbalanced across fixtures;
this is not a statistical speed comparison or a measurement of human setup effort.
Direct command count describes this scripted workflow, not universal user effort.
Human understanding, review quality and maintenance-effort comparisons remain pending.
