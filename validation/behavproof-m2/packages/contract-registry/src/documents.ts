import {
  canonicalJson,
  ApprovalSchema,
  type RegistrySnapshot,
  type Approval,
} from "@behavproof/core";
import { bindingKey, validExecution, type ExecutionRow } from "./assurance.js";
const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const escapeMd = (s: string) =>
  escapeHtml(s).replace(/([\\`*_{}\[\]()#+.!|~])/g, "\\$1");
export type DocumentOptions = {
  approvals?: readonly Approval[];
  expectedBindings?: Readonly<Record<string, string>>;
  verifyEvidence?: (row: ExecutionRow) => boolean;
  verifyApproval?: (approval: Approval) => boolean;
};
export function renderDocuments(
  data: Pick<RegistrySnapshot, "contracts" | "intents">,
  execution: readonly ExecutionRow[] = [],
  options: DocumentOptions = {},
) {
  const ordered = {
    contracts: [...data.contracts].sort((a, b) => a.id.localeCompare(b.id)),
    intents: [...data.intents].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const rows = execution
    .map((r) => {
      const c = ordered.contracts.find((x) => x.id === r.contractId);
      const valid =
        !!c &&
        c.revisionHash === r.revisionHash &&
        !!c.caseIds?.includes(r.caseId) &&
        options.expectedBindings?.[
          bindingKey(r.contractId, r.caseId, r.testId)
        ] === r.bindingHash &&
        validExecution(r) &&
        options.verifyEvidence?.(r) === true;
      return {
        ...r,
        effectiveStatus:
          valid && (r.status !== "pass" || r.comparisonCount > 0)
            ? r.status
            : "unknown",
      };
    })
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const approvals = (options.approvals ?? []).filter(a => ApprovalSchema.safeParse(a).success)
    .map((a) => {
      const entity =
        a.target.kind === "intent"
          ? ordered.intents.find((i) => i.id === a.target.id)
          : a.target.kind === "contract"
            ? ordered.contracts.find((c) => c.id === a.target.id)
            : undefined;
      const content =
        entity &&
        ("revisionHash" in entity ? entity.revisionHash : entity.contentHash);
      const valid =
        ApprovalSchema.safeParse(a).success &&
        content === a.target.contentHash &&
        options.verifyApproval?.(a) === true;
      return { ...a, effectiveStatus: valid ? a.status : "unknown" };
    })
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const markdown =
    "# Generated contract declarations\n\nDo not edit; regenerate from source. Declarations do not prove execution or production reach.\n\n" +
    ordered.contracts
      .map(
        (c) =>
          `## ${escapeMd(c.id)}\n\nSource: ${escapeMd(c.sourceRef)}\n\n${(c.cases ?? []).map(k => `Case ${escapeMd(k.id)} — Input: ${escapeMd(canonicalJson(k.input))}; Expected: ${escapeMd(canonicalJson(k.expected))}`).join("\n\n")}\n\n${c.intentIds.map((id) => escapeMd(ordered.intents.find((i) => i.id === id)?.statement ?? id)).join("\n\n")}\n`,
      )
      .join("\n") +
    "\n## Scoped execution comparisons\n\n" +
    rows
      .map(
        (r) =>
          `${escapeMd(r.contractId)} / ${escapeMd(r.caseId)}: ${escapeMd(r.effectiveStatus)} (${r.comparisonCount} comparisons; revision ${escapeMd(r.revisionHash)}; binding ${escapeMd(r.bindingHash)})`,
      )
      .join("\n\n") +
    "\n\n## Approval evidence\n\n" +
    approvals
      .map(
        (a) =>
          `${escapeMd(a.target.kind)} / ${escapeMd(a.target.id)}: ${escapeMd(a.effectiveStatus)} (source ${escapeMd(a.source.provider)} / ${escapeMd(a.source.ref)}; content ${escapeMd(a.target.contentHash)})`,
      )
      .join("\n\n") +
    "\n";
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><title>Contract declarations</title></head><body><h1>Generated contract declarations</h1><p>Do not edit; declarations do not prove execution or production reach.</p>' +
    ordered.contracts
      .map(
        (c) =>
          `<section><h2>${escapeHtml(c.id)}</h2><p>Source: ${escapeHtml(c.sourceRef)}</p>${(c.cases ?? []).map(k => `<p>Case ${escapeHtml(k.id)} — Input: ${escapeHtml(canonicalJson(k.input))}; Expected: ${escapeHtml(canonicalJson(k.expected))}</p>`).join("")}${c.intentIds.map((id) => `<p>${escapeHtml(ordered.intents.find((i) => i.id === id)?.statement ?? id)}</p>`).join("")}</section>`,
      )
      .join("") +
    "<h2>Scoped execution comparisons</h2>" +
    rows
      .map(
        (r) =>
          `<p>${escapeHtml(r.contractId)} / ${escapeHtml(r.caseId)}: ${escapeHtml(r.effectiveStatus)} (${r.comparisonCount} comparisons; revision ${escapeHtml(r.revisionHash)}; binding ${escapeHtml(r.bindingHash)})</p>`,
      )
      .join("") +
    "<h2>Approval evidence</h2>" +
    approvals
      .map(
        (a) =>
          `<p>${escapeHtml(a.target.kind)} / ${escapeHtml(a.target.id)}: ${escapeHtml(a.effectiveStatus)} (source ${escapeHtml(a.source.provider)} / ${escapeHtml(a.source.ref)}; content ${escapeHtml(a.target.contentHash)})</p>`,
      )
      .join("") +
    "</body></html>\n";
  return {
    markdown,
    html,
    json:
      canonicalJson({
        notice:
          "Generated; do not edit. Declarations do not prove execution or production reach.",
        ...ordered,
        execution: rows,
        approvals,
      }) + "\n",
  };
}
export function checkDocuments(
  expected: ReturnType<typeof renderDocuments>,
  actual: Partial<ReturnType<typeof renderDocuments>>,
): string[] {
  return (Object.keys(expected) as (keyof typeof expected)[])
    .filter((k) => expected[k] !== actual[k])
    .map(() => "DOCUMENT_OUTDATED");
}
