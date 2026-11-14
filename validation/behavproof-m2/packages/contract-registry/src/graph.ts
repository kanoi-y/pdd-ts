import {
  canonicalJson,
  ApprovalSchema,
  type RegistrySnapshot,
  type Approval,
} from "@behavproof/core";
import { bindingKey, validExecution, type ExecutionRow } from "./assurance.js";
export type GraphNode = {
  kind: "intent" | "contract" | "case" | "execution" | "rule" | "approval";
  id: string;
};
export type GraphEdge = {
  kind:
    | "intent_described_by_contract"
    | "contract_has_case"
    | "case_executed_by_test"
    | "evidence_supports_rule"
    | "approved_by";
  from: GraphNode;
  to: GraphNode;
  status: "pass" | "fail" | "unknown";
};
export type GraphExecution = ExecutionRow & {
  id: string;
};
export type GraphInput = {
  registry: Pick<RegistrySnapshot, "contracts" | "intents">;
  executions: readonly GraphExecution[];
  rules: readonly {
    id: string;
    evidenceIds: readonly string[];
  }[];
  approvals: readonly Approval[];
  expectedBindings: Readonly<Record<string, string>>;
};
export function buildEvidenceGraph(
  input: GraphInput,
  verifyEvidence: (row: GraphExecution) => boolean = () => false,
  verifyApproval: (approval: Approval) => boolean = () => false,
) {
  const edges: GraphEdge[] = [];
  const node = (kind: GraphNode["kind"], id: string): GraphNode => ({
    kind,
    id,
  });
  const edge = (
    kind: GraphEdge["kind"],
    from: GraphNode,
    to: GraphNode,
    status: GraphEdge["status"],
  ) => edges.push({ kind, from, to, status });
  for (const c of input.registry.contracts) {
    for (const id of c.intentIds)
      edge(
        "intent_described_by_contract",
        node("intent", id),
        node("contract", c.id),
        input.registry.intents.some((i) => i.id === id) ? "pass" : "unknown",
      );
    for (const id of c.caseIds ?? [])
      edge(
        "contract_has_case",
        node("contract", c.id),
        node("case", canonicalJson([c.id, id])),
        "pass",
      );
  }
  const statuses = new Map<string, GraphEdge["status"]>();
  const counts = new Map<string, number>();
  for (const row of input.executions)
    counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  for (const row of input.executions) {
    const contract = input.registry.contracts.find(
      (c) => c.id === row.contractId,
    );
    const matches =
      counts.get(row.id) === 1 &&
      validExecution(row) &&
      contract?.caseIds?.includes(row.caseId) &&
      contract.revisionHash === row.revisionHash &&
      input.expectedBindings[
        bindingKey(row.contractId, row.caseId, row.testId)
      ] === row.bindingHash &&
      verifyEvidence(row) === true;
    const status: GraphEdge["status"] = !matches
      ? "unknown"
      : row.status === "fail"
        ? "fail"
        : row.status === "pass" && row.comparisonCount > 0
          ? "pass"
          : "unknown";
    statuses.set(row.id, status);
    edge(
      "case_executed_by_test",
      node("case", canonicalJson([row.contractId, row.caseId])),
      node("execution", row.id),
      status,
    );
  }
  for (const rule of input.rules)
    for (const id of rule.evidenceIds)
      edge(
        "evidence_supports_rule",
        node("execution", id),
        node("rule", rule.id),
        statuses.get(id) ?? "unknown",
      );
  for (const a of input.approvals) {
    const parsed = ApprovalSchema.safeParse(a);
    if (!parsed.success) continue;
    const entity =
      a.target.kind === "intent"
        ? input.registry.intents.find((i) => i.id === a.target.id)
        : a.target.kind === "contract"
          ? input.registry.contracts.find((c) => c.id === a.target.id)
          : undefined;
    const content =
      entity &&
      ("revisionHash" in entity ? entity.revisionHash : entity.contentHash);
    const valid =
      parsed.success &&
      a.status === "pass" &&
      content === a.target.contentHash &&
      verifyApproval(a) === true;
    if (a.target.kind === "intent" || a.target.kind === "contract")
      edge(
        "approved_by",
        node(a.target.kind, a.target.id),
        node("approval", a.id),
        valid ? "pass" : "unknown",
      );
  }
  return { edges };
}
