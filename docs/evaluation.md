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

## Actual maintainer feedback

The maintainer personally approved the initial specification but reported that the
Japanese PR body was too difficult to understand and needed improvement. This is
negative qualitative feedback about readability, not a successful understanding
or cognitive-load evaluation. Reading time, comprehension answers and matched
setup/update/maintenance comparisons were not supplied. Preserve the distinction
between code/specification approval and evidence that the review presentation is
useful. A concise statement of the current change and required decisions should
precede complete drill-down data in the next iteration.

## Presentation QA before a second human trial

On the same frozen13-requirement snapshot from main4469836, the updated renderer
retained all52 original preformatted specification blocks byte for byte inside
the details section. The initial Markdown source is440characters instead of the
previous35,818characters; the complete payload remains present. These are source
layout measurements, not rendered reading time or participant answers. Added or
unapproved boundary premises and changed source premises remain visible before
the fold. The next human trial must still identify proof scope, trust boundaries,
missing evidence and pending approval and compare actual effort against direct tools.
