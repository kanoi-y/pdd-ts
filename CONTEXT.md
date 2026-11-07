# Domain vocabulary

- **Requirement**: human intent, identified and versioned separately from the implementation.
- **Contract**: all source `//@` clauses for a verified symbol, including preconditions; not a generated YAML formula.
- **Obligation**: a required evidence item declared before the run. The required set is protected state.
- **Evidence**: one result from a concrete run, target and toolchain. It does not itself decide the merge gate.
- **Gate**: checks the complete required set, status, source identity, freshness, assumptions and approval context.
- **Witness**: a concrete input satisfying a precondition in the supported formal semantics. Finding none is not a proof of unsatisfiability and cannot pass the premise gate.
- **Trusted boundary**: an explicit dependency or premise outside formal proof, with a declared empirical or human confirmation requirement.
- **Approval**: an external human decision tied to a specification digest and revision; a local JSON flag is never sufficient.
- **Review Packet**: a read-only view of requirements, actual evidence, missing evidence, decisions and run links.
- **Source proof**: a verifier result for the extracted model of the real TS source, conditional on the documented semantic profile and trust base.
