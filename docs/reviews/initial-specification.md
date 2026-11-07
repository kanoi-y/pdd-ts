# Initial specification review request

This document requests review of the complete initial specification and records no
approval. The PR explicitly registers both sample specifications and required proofs;
no source contract or input premise is weakened.

The Bot-created PR body contains immutable source/configuration links, all thirteen
requirements, every extracted source clause, the four required obligations, eleven
runtime boundaries and the complete approved assumptions. Review the exact head
personally using GitHub's review interface. Source proof, empirical tests, native
CI signatures and human approval are separate evidence.

The tested source-proof profile is deliberately restricted; a passing proof does
not prove Node, HTTP identity providers, the translation toolchain or the test
harness correct. The Hono example is a staged-adoption sample, not an external
production pilot. Machine comparison is not a human usability study.

For the predeclared evaluation protocol in ../evaluation.md, record actual review
time and whether you can identify the proved property, unverified boundaries,
additional assumptions and pending approval. Human setup/maintenance comparisons
remain pending until measured; do not infer them from this initial review.

The root protected registry includes the complete Hono and bigint specifications,
source-proof obligations and actual runtime boundaries. Both sample source proofs
and their existing 24/34 runtime cases are therefore required by the same signed
protected gate, rather than relying on separate ordinary-CI demo successes.
