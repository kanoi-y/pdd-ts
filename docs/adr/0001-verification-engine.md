# ADR-0001: LemmaScript as a restricted source-proof backend

Date: 2026-11-07. Status: selected for the observed Phase 0 profile; extending the profile requires new conformance evidence.

## Decision

Use LemmaScript 0.6.6, Dafny 4.11.0 and its bundled Z3. Pin dependencies in `pnpm-lock.yaml`, verify official Dafny archive SHA-256, and install into ignored `.tools/` instead of the user's global environment. See `docs/evidence/p0-results.json` for actual observations and `docs/compatibility.md` for the profile.

Verify production `.ts`, not a separately maintained Dafny business implementation. The initial profile admits synchronous pure functions over boolean, string literal comparisons, bigint addition/subtraction/comparison, branches and value records after conformance checks. Reject constructs outside that profile rather than approximating them. All required source contracts and explicit premise witnesses must be accounted for; generated proof additions and verifier flags are part of the trust/freshness boundary.

## Alternatives and reuse

- **Microsoft PDD Kit:** the intent, approval, trust boundary and evidence workflow is the model for this project. Rust-specific verification does not satisfy the TypeScript source requirement.
- **Dafny-first generated TypeScript:** reasonable for a new domain core, but would change the approved source-of-truth model and require existing TS to be rewritten.
- **Direct LemmaScript:** chosen proof engine. Add pdd-ts obligations, approval binding, run identity, boundary linkage and review packet around its public CLI; do not implement a new solver or contract language.


## Trust base and consequences

The TS frontend, translation passes, Dafny/Z3, trusted standard/preamble code, Node runtime and build chain remain trusted. Fixture checks can find mismatches but do not prove all translations preserve meaning. Evidence states this conditional guarantee. Runtime inputs need explicit validation or verified callers; a callee contract does not establish a whole endpoint's correctness.

The approved source plan is execution authorization, not an external GitHub contract approval. No remote or repository protection initially exists. Implement and test external approval/CI against controlled API fixtures, but keep actual human/hosted verification pending until real external evidence is available.

## Publication scope update

The user authorized a new public OSS repository on 2026-11-07, requested a safety review, and requested that public documentation describe only directly used tools. There is no supplied existing Hono project; use a clearly labeled reproducible brownfield-style Hono sample, without claiming an external live application trial. Publish a sanitized initial snapshot, not the local development history containing machine-specific experiment paths or superseded planning references.

## Review amendment

Independent review reproduced false source proofs by adding a lemma-only false premise or replacing generated declarations inside additions-only handproofs. The initial source-proof profile therefore requires the verified `.dfy` to equal the freshly regenerated `.dfy.gen` byte for byte, in addition to witness and assumption audit. Arbitrary handproof extensions are unsupported; their safe integration is deferred rather than trusted implicitly.
