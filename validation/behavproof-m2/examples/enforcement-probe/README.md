# Isolated external-enforcement positive control

This is a separate basic-risk toy project for the actual dedicated check issuer and skip/deletion/wrong-issuer tests. It does not change or replace the approved critical Node API baseline. Its explicit policy requires real tests, protected pipeline and policy, human Intent approval, contract comparisons, per-case reach and fault sensitivity. Changed-line coverage is a warning; aggregate mutation score is off. It makes no coverage or aggregate mutation-quality claim.

Before using it in protected CI, enroll this exact project's policy and declarations through actual same-head human review. The producer and publisher templates run only from registered main source, target PRs only to `behavproof-enforcement-test`, and use admin-provisioned registration/digest variables. A file named `policy.json` is proposed policy data, never authority by itself.
