# Node API service example

Install the locally packed `@behavproof/core`, `@behavproof/vitest` packages and Vitest 5.1.0, then run `npm test`. `readOrder` is the application service used at the API boundary. Two explicit contract cases cover owner and non-owner access.

Use the BehavProof Vitest reporter together with Vitest JSON output. The helper proves case comparisons and runtime binding. It does not independently prove production reach, sufficient business requirements or mutation sensitivity. The acceptance script runs an injected ownership fault and a fake callback to disclose those separate limits.
