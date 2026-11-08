# Verification compatibility and trust boundary

## Pinned toolchain

- LemmaScript 0.6.6 (`lemmascript`, MIT), from the pinned npm lockfile.
- Dafny 4.11.0+fcb2042d6d043a2634f0854338c08feeaaaf4ae2 (MIT), official release archive checked against SHA-256 in `scripts/install-dafny.mjs`.
- Dafny distribution contains Z3 4.12.1 and 4.14.1. The adapter explicitly selects 4.14.1 and records the solver, Dafny core, Node binary, frontend code and pdd-ts code fingerprints for each run.
- Current experiment host: Node 24.14.1 / macOS ARM64. CLI target: Node >=22. Other supported CI platforms require their own execution evidence.
- Profile: `extern-default=impure`, `dafny-library=local`, `string-semantics=javascript-utf16`, logging enabled. No source directives may silently override the profile.

## Observed profile

Run `node scripts/install-dafny.mjs`, then `pnpm test:poc`. Actual source hashes, commands, outputs, exit codes and timings are in `docs/evidence/p0-results.json`. The script is a Phase 0 experiment; its witness probes are not the production adapter or a translation-correctness proof.

| Construct | MVP policy | Evidence and limits |
|---|---|---|
| boolean and string literal equality, conjunction/negation | Admit after target AST/contract checks | Real auth proof; always-true, missing-role and inverted-password mutants rejected |
| bigint addition, subtraction, comparisons | Admit after target AST/contract checks | Nonnegative remainder and total conservation; lost-unit mutant rejected |
| branches and value records | Admit after target AST/contract checks | `split` constrains both shares and preserves the total across branches |
| bigint division/remainder | Excluded initially | Positive and negative division probed; successful sample proofs do not establish all sign/zero cases |
| `number`, including integer-looking numbers | Excluded | Mathematical addition can prove a strict increase while `9007199254740992 + 1` rounds to the same JS number |
| null and undefined | Excluded | Typed extraction merges the optional models, although JS distinguishes the values |
| async/await, promises | Excluded | Not part of synchronous source-proof profile; empirical integration; the separate finite queue model does not prove async TypeScript source semantics |
| throwing, external calls, mutation/aliasing, loops | Excluded initially | Dedicated probes recorded; future admission requires specified exception/effect/termination semantics and conformance fixtures |
| imported executable logic, dynamic loading and unknown dependencies | Excluded unless full scope can be established | Type/source dependency changes must invalidate freshness; unresolved dependencies cannot be silently trusted |
| contradictory preconditions | Never accepted as ordinary functional proof | `vacuous` proves its postcondition in the solver; independent concrete witness/premise gate rejects it |
| source functions without postconditions | Never satisfy a required proof | Verifier success can mean zero relevant properties checked |
| handwritten Dafny additions, assumptions or verification bypass | Reject in the initial source-proof profile; `.dfy` must equal freshly regenerated `.dfy.gen` byte for byte | Additions-only plus audit can miss inserted lemma premises and commented-out/replaced declarations |

## Adapter requirements learned from the experiment

- A process exit of 0 alone is insufficient. Require the expected functions/contracts and positive verified member results from this exact invocation; never use an older run-log entry.
- `lsc info --typed` exposes typed expression trees, externs, body kinds, emitted Dafny names and contracts; `lsc extract` exposes source annotations. Parse supported schemas strictly, not arbitrary successful JSON.
- `lsc gen-check` freshly regenerates `.dfy.gen`; its additions-only check is insufficient to preserve semantics. pdd-ts additionally requires byte equality with `.dfy` before audit/verification. Both files remain fingerprinted. Handwritten proof additions are not supported by the initial profile; safe extension support needs a separate sound design.
- `dafny audit` may return exit 0 with findings. Parse and compare the actual findings; absent/malformed output is not clean. Dafny 4.11's auditor does not support JSON output (`--report-format json` is rejected); text/Markdown are available.
- Bare `assume false` currently triggers a warning and exit 1 under default warning policy. `assume {:axiom} false` demonstrates the underlying bypass without that warning. Do not rely on the default warning policy as the only defense.
- No assumptions, missing clauses, skipped targets, stale sidecars or unresolved premise witnesses may be turned into a passed required source proof.

## TCB and conditional claims

Trust includes TypeScript/LemmaScript extraction and lowering, configured character/integer semantics, Dafny, Z3, generated support code, Node/runtime/build tools and the execution environment. Hashes bind inputs; they do not establish that a claimed run occurred. External CI identity and approval validation supply separate evidence.

Passing these finite probes is evidence for selecting a restricted profile. It is not a proof that the translator is sound for every admitted program. State the profile and assumptions in every source-proof report; use runtime validation and tests at unverified callers and I/O boundaries.

The first production profile rejects executable imports, nested functions, arbitrary calls, mutable variables, prototype-sensitive record keys and arithmetic on non-bigint values. It typechecks admitted source using ts-morph's in-memory standard libraries before invoking the proof frontend. Missing dependency scope is never filled by an implicit trusted contract.

## Finite queue model adapter

`job-queue-v1` is a built-in explicit-state breadth-first checker, not a source-proof backend. The fixed properties are at most one active worker, bounded attempts and absence of reachable nonterminal deadlocks. The finite instance has one job, 2–4 workers and 1–5 attempts. No fairness or eventual-success property is asserted. A search limit (10,000 states / depth128 / 100,000 transitions / 1second maximum) returns unknown unless closure is exhausted. Failed results carry a shortest reachable counterexample.

Model JSON, authored implementation mapping and mapped file bytes bind to specification and evidence digests. Mapping is explanatory data, not a verified refinement. Trace matching checks only the supplied observed trace. The SQLite example uses actual independent connections and worker threads; its SQLite API is experimental in pinned Node24.14.1. It assumes process death has been confirmed before crash/recovery; a lease timeout alone is insufficient. No external-effect exactly-once or production distributed-system guarantee follows.
