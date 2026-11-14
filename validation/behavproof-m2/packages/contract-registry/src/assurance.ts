import {
  canonicalJson,
  type Contract,
  type RegistrySnapshot,
} from "@behavproof/core";
export function bindingKey(
  contractId: string,
  caseId: string,
  testId?: string,
): string {
  return canonicalJson(
    testId === undefined ? [contractId, caseId] : [contractId, caseId, testId],
  );
}
export type ExecutionRow = {
  testId?: string;
  contractId: string;
  caseId: string;
  revisionHash: string;
  bindingHash: string;
  comparisonCount: number;
  status: "pass" | "fail" | "unknown";
};
export const validCount = (n: number) => Number.isSafeInteger(n) && n >= 0;
export const validExecution = (r: ExecutionRow) =>
  !!r.contractId &&
  !!r.caseId &&
  /^[a-f0-9]{64}$/.test(r.revisionHash) &&
  /^[a-f0-9]{64}$/.test(r.bindingHash) &&
  validCount(r.comparisonCount) &&
  ["pass", "fail", "unknown"].includes(r.status);
export function evaluateAssurance(
  inventory: readonly Contract[] | RegistrySnapshot,
  rows: readonly ExecutionRow[],
  expectedBindings: Readonly<Record<string, string>> = {},
  verifyEvidence: (row: ExecutionRow) => boolean = () => false,
) {
  const snapshot = Array.isArray(inventory)
    ? undefined
    : (inventory as RegistrySnapshot);
  const contracts = (
    snapshot ? snapshot.contracts : inventory
  ) as readonly Contract[];
  const discoveryComplete = snapshot?.discoveryDiagnostics?.length === 0;
  const required = contracts.flatMap((c) =>
    (c.caseIds ?? []).map((id) => ({ contract: c, caseId: id })),
  );
  const matched = required.map(({ contract, caseId }) =>
    rows.filter(
      (r) =>
        r.contractId === contract.id &&
        r.caseId === caseId &&
        r.revisionHash === contract.revisionHash &&
        validExecution(r) &&
        verifyEvidence(r) === true,
    ),
  );
  const failed = matched.some((rs) => rs.some((r) => r.status === "fail"));
  const complete =
    discoveryComplete &&
    contracts.every((contract) => (contract.caseIds?.length ?? 0) > 0) &&
    required.length > 0 &&
    matched.every((rs) => {
      const ids = rs.map((r) => r.testId ?? "");
      return (
        rs.length > 0 &&
        new Set(ids).size === ids.length &&
        rs.every(
          (r) =>
            r.status === "pass" &&
            r.comparisonCount > 0 &&
            expectedBindings[bindingKey(r.contractId, r.caseId, r.testId)] ===
              r.bindingHash,
        )
      );
    });
  return {
    contract_declared:
      discoveryComplete && contracts.length ? "pass" : "unknown",
    binding_verified: complete ? "pass" : "unknown",
    cases_executed: failed ? "fail" : complete ? "pass" : "unknown",
    production_target_observed: "unknown",
    mutation_sensitivity_observed: "unknown",
    model_conformance_observed: "unknown",
  } as const;
}
export type ClaimScope = {
  contractId: string;
  caseIds: readonly string[];
  targetRef: string;
  method: string;
};
type Observation = ClaimScope & {
  observations: number;
  status: "pass" | "fail" | "unknown";
};
type Canary = ClaimScope & {
  detected: number;
  total: number;
  status: "pass" | "fail" | "unknown";
};
/** All rows must have been authenticated and freshness-checked by the caller. */
export function evaluateScopedClaims(
  contract: Contract,
  scope: ClaimScope,
  observations: readonly Observation[],
  canaries: readonly Canary[],
  rows: readonly ExecutionRow[] = [],
  expectedBindings: Readonly<Record<string, string>> = {},
  verifyEvidence: (row: ExecutionRow | Observation | Canary) => boolean = () =>
    false,
) {
  const validScope =
    scope.contractId === contract.id &&
    scope.caseIds.length > 0 &&
    !!scope.targetRef &&
    !!scope.method &&
    new Set(scope.caseIds).size === scope.caseIds.length &&
    scope.caseIds.every((id) => contract.caseIds?.includes(id));
  const matches = (v: ClaimScope) =>
    validScope &&
    v.contractId === scope.contractId &&
    v.targetRef === scope.targetRef &&
    v.method === scope.method &&
    v.caseIds.length > 0 &&
    v.caseIds.every((id) => scope.caseIds.includes(id));
  const observation = observations.filter(
      (x) =>
        matches(x) &&
        validCount(x.observations) &&
        ["pass", "fail", "unknown"].includes(x.status) &&
        verifyEvidence(x) === true,
    ),
    canary = canaries.filter(
      (x) =>
        matches(x) &&
        validCount(x.detected) &&
        validCount(x.total) &&
        x.detected <= x.total &&
        ["pass", "fail", "unknown"].includes(x.status) &&
        verifyEvidence(x) === true,
    );
  const status = (
    items: readonly {
      status: string;
    }[],
    pass: boolean,
  ) =>
    items.some((i) => i.status === "fail") ? "fail" : pass ? "pass" : "unknown";
  const negative =
    contract.cases?.filter((c) => c.negative && scope.caseIds.includes(c.id)) ??
    [];
  const negativeRows = validScope
    ? rows.filter(
        (r) =>
          negative.some((c) => c.id === r.caseId) &&
          r.contractId === contract.id &&
          r.revisionHash === contract.revisionHash &&
          validExecution(r) &&
          verifyEvidence(r) === true,
      )
    : [];
  const requiredKeys = (caseId: string) => {
    const keys = Object.keys(expectedBindings).filter((key) => {
      try {
        const parts: unknown = JSON.parse(key);
        return (
          Array.isArray(parts) &&
          (parts.length === 2 || parts.length === 3) &&
          parts[0] === contract.id &&
          parts[1] === caseId
        );
      } catch {
        return false;
      }
    });
    const triples = keys.filter((key) => JSON.parse(key).length === 3);
    return triples.length
      ? triples
      : keys.filter((key) => JSON.parse(key).length === 2);
  };
  const bound = (r: ExecutionRow) => {
    const key = bindingKey(r.contractId, r.caseId, r.testId);
    return (
      requiredKeys(r.caseId).includes(key) &&
      expectedBindings[key] === r.bindingHash
    );
  };
  const negativeFailed = negativeRows.some(
    (r) => r.status === "fail" && bound(r),
  );
  const negativeComplete =
    validScope &&
    negative.length > 0 &&
    negative.every((c) => {
      const matched = negativeRows.filter((r) => r.caseId === c.id);
      const required = requiredKeys(c.id);
      if (!required.length || matched.length !== required.length) return false;
      const actual = matched.map((r) =>
        bindingKey(r.contractId, r.caseId, r.testId),
      );
      return (
        new Set(actual).size === actual.length &&
        required.every((key) => actual.includes(key)) &&
        matched.every(
          (r) => r.status === "pass" && r.comparisonCount > 0 && bound(r),
        )
      );
    });
  return {
    negative_cases: negativeFailed
      ? "fail"
      : negativeComplete
        ? "pass"
        : "unknown",
    production_target_observed: status(
      observation,
      validScope &&
        scope.caseIds.every((id) =>
          observation.some(
            (o) =>
              o.caseIds.length === 1 &&
              o.caseIds[0] === id &&
              o.status === "pass" &&
              o.observations > 0,
          ),
        ),
    ),
    mutation_sensitivity_observed: status(
      canary,
      validScope &&
        scope.caseIds.every((id) =>
          canary.some(
            (c) =>
              c.caseIds.length === 1 &&
              c.caseIds[0] === id &&
              c.status === "pass" &&
              c.total > 0 &&
              c.detected > 0,
          ),
        ),
    ),
  };
}
export type ReportBinding = {
  testId: string;
  contractId: string;
  caseId: string;
  revisionHash: string;
  bindingHash: string;
  bindingScope: string;
  comparisonCount: number;
  status: string;
};
/** Caller verifies both collections belong to one authenticated current Collector execution. */
export function bindRegistrations(
  registrations: readonly ReportBinding[],
  rows: readonly ReportBinding[],
  verifyReport: () => boolean = () => false,
): {
  status: "pass" | "unknown";
  bindings: Record<string, string>;
} {
  const empty = () => ({ status: "unknown" as const, bindings: {} });
  if (
    verifyReport() !== true ||
    !registrations.length ||
    registrations.length !== rows.length
  )
    return empty();
  const bindings: Record<string, string> = Object.create(null),
    ids = new Set<string>();
  for (const r of registrations) {
    if (
      !r.testId ||
      !r.contractId ||
      !r.caseId ||
      r.bindingScope !== "runtime-function-string-v1" ||
      r.comparisonCount !== 0 ||
      r.status !== "unknown" ||
      !/^([a-f0-9]{64})$/.test(r.bindingHash) ||
      !/^([a-f0-9]{64})$/.test(r.revisionHash) ||
      ids.has(r.testId)
    )
      return empty();
    ids.add(r.testId);
    const key = bindingKey(r.contractId, r.caseId, r.testId);
    const matches = rows.filter((x) => x.testId === r.testId);
    if (matches.length !== 1) return empty();
    const x = matches[0]!;
    if (
      x.contractId !== r.contractId ||
      x.caseId !== r.caseId ||
      x.revisionHash !== r.revisionHash ||
      x.bindingHash !== r.bindingHash ||
      x.bindingScope !== r.bindingScope
    )
      return empty();
    bindings[key] = r.bindingHash;
    const caseKey = bindingKey(r.contractId, r.caseId);
    const count = registrations.filter(
      (x) => x.contractId === r.contractId && x.caseId === r.caseId,
    ).length;
    if (count === 1) bindings[caseKey] = r.bindingHash;
  }
  return { status: "pass", bindings };
}
