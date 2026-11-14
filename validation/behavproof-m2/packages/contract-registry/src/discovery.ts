import ts from "typescript-parser";
import {
  hash,
  ContractSchema,
  RegistrySnapshotSchema,
  type Contract,
  type Intent,
  type RegistrySnapshot,
} from "@behavproof/core";
export const EXTRACTOR_VERSION = "1";
export type Diagnostic = {
  code: string;
  sourceRef: string;
  message: string;
};
export type Discovery = {
  contracts: Contract[];
  intents: Intent[];
  diagnostics: Diagnostic[];
};
function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text);
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map((e) => {
      if (ts.isSpreadElement(e)) throw Error("spread");
      return literal(e);
    });
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const p of node.properties) {
      if (
        !ts.isPropertyAssignment(p) ||
        !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
      )
        throw Error("non-literal property");
      const key = p.name.text;
      if (Object.hasOwn(result, key)) throw Error("duplicate property");
      result[key] = literal(p.initializer);
    }
    return result;
  }
  throw Error("non-literal expression");
}
function add(
  raw: unknown,
  ref: string,
  out: Discovery,
  originKind: "inline" | "manifest" = "inline",
) {
  const v = raw as {
    id: string;
    intent: string;
    risk: "basic" | "standard" | "critical";
    cases: {
      id: string;
      input: unknown;
      expected: unknown;
      negative?: boolean;
    }[];
  };
  if (
    !v ||
    typeof v !== "object" ||
    typeof v.id !== "string" ||
    !v.id ||
    typeof v.intent !== "string" ||
    !v.intent ||
    !["basic", "standard", "critical"].includes(v.risk) ||
    !Array.isArray(v.cases)
  )
    throw Error("invalid contract literal");
  const intentId = `${v.id}:intent`;
  const intent = {
    id: intentId,
    statement: v.intent,
    risk: v.risk,
    contentHash: hash({ id: intentId, statement: v.intent, risk: v.risk }),
    origin: { kind: originKind, ref },
  };
  const revisionHash = hash({
    id: v.id,
    intent: v.intent,
    risk: v.risk,
    cases: v.cases,
  });
  const contract = ContractSchema.parse({
    id: v.id,
    kind: "examples",
    intentIds: [intentId],
    revisionHash,
    sourceRef: ref,
    risk: v.risk,
    cases: v.cases,
    caseIds: v.cases.map((c) => c.id),
  });
  if (new Set(contract.caseIds).size !== contract.caseIds!.length)
    throw Error("duplicate case IDs");
  if (out.contracts.some((c) => c.id === contract.id))
    throw Error("duplicate contract IDs");
  out.intents.push(intent);
  out.contracts.push(contract);
}
export function discover(files: Readonly<Record<string, string>>): Discovery {
  const out: Discovery = { contracts: [], intents: [], diagnostics: [] };
  for (const [ref, source] of Object.entries(files).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!/\.[cm]?[jt]sx?$/.test(ref)) {
      out.diagnostics.push({
        code: "UNSUPPORTED_SOURCE",
        sourceRef: ref,
        message: "Unsupported source kind",
      });
      continue;
    }
    const file = ts.createSourceFile(
      ref,
      source,
      ts.ScriptTarget.Latest,
      true,
      ref.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const names = new Set<string>();
    const namespaces = new Set<string>();
    for (const statement of file.statements)
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "@behavproof/vitest"
      ) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings))
          namespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings))
          for (const element of bindings.elements)
            if (
              (element.propertyName?.text ?? element.name.text) ===
              "defineContract"
            )
              names.add(element.name.text);
      }
    const visit = (node: ts.Node) => {
      if (
        ts.isIdentifier(node) &&
        ((names.has(node.text) &&
          !ts.isImportSpecifier(node.parent) &&
          !(
            ts.isCallExpression(node.parent) && node.parent.expression === node
          )) ||
          (namespaces.has(node.text) && !ts.isNamespaceImport(node.parent)))
      )
        out.diagnostics.push({
          code: "CONTRACT_DISCOVERY_UNKNOWN",
          sourceRef: ref,
          message: "Indirect or namespace contract helper usage",
        });
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) &&
          node.expression.text === "require") ||
          node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
        node.arguments.some(
          (a) => ts.isStringLiteral(a) && a.text === "@behavproof/vitest",
        )
      )
        out.diagnostics.push({
          code: "CONTRACT_DISCOVERY_UNKNOWN",
          sourceRef: ref,
          message: "Dynamic official helper import",
        });
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        names.has(node.expression.text)
      ) {
        try {
          const d = node.parent;
          if (
            !ts.isVariableDeclaration(d) ||
            !ts.isVariableDeclarationList(d.parent) ||
            !ts.isVariableStatement(d.parent.parent) ||
            d.parent.parent.parent !== file ||
            node.arguments.length !== 1
          )
            throw Error("conditional or unsupported registration");
          add(literal(node.arguments[0]!), ref, out);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (message.toLowerCase().includes("duplicate")) throw e;
          out.diagnostics.push({
            code: "CONTRACT_DISCOVERY_UNKNOWN",
            sourceRef: ref,
            message,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (
      (
        file as ts.SourceFile & {
          parseDiagnostics?: unknown[];
        }
      ).parseDiagnostics?.length
    )
      out.diagnostics.push({
        code: "CONTRACT_DISCOVERY_UNKNOWN",
        sourceRef: ref,
        message: "Parse error",
      });
  }
  return out;
}
export function snapshot(
  discovery: Discovery,
  commitSha: string,
  scope: string[],
): RegistrySnapshot {
  return RegistrySnapshotSchema.parse({
    schemaVersion: 1,
    commitSha,
    contracts: discovery.contracts,
    intents: discovery.intents,
    extractorVersion: EXTRACTOR_VERSION,
    discoveryDiagnostics: discovery.diagnostics,
    scope,
  });
}
export function discoverSources(
  sources: readonly {
    kind: string;
    ref: string;
    content: string;
  }[],
): Discovery {
  const out: Discovery = { contracts: [], intents: [], diagnostics: [] };
  for (const source of sources) {
    if (source.kind === "vitest-inline") {
      const result = discover({ [source.ref]: source.content });
      for (const c of result.contracts)
        if (out.contracts.some((x) => x.id === c.id))
          throw Error("duplicate contract IDs");
      out.contracts.push(...result.contracts);
      out.intents.push(...result.intents);
      out.diagnostics.push(...result.diagnostics);
      continue;
    }
    if (source.kind !== "manifest" || !source.ref.endsWith(".json")) {
      out.diagnostics.push({
        code: "UNSUPPORTED_SOURCE",
        sourceRef: source.ref,
        message: `Unsupported source kind ${source.kind}`,
      });
      continue;
    }
    try {
      const value = JSON.parse(source.content);
      const tree = ts.parseJsonText(source.ref, source.content);
      const visit = (n: ts.Node) => {
        if (ts.isObjectLiteralExpression(n)) {
          const keys = new Set<string>();
          for (const p of n.properties) {
            if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name)) {
              if (keys.has(p.name.text)) throw Error("duplicate property");
              keys.add(p.name.text);
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(tree);
      add(value, source.ref, out, "manifest");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes("duplicate")
      )
        throw error;
      out.diagnostics.push({
        code: "CONTRACT_DISCOVERY_UNKNOWN",
        sourceRef: source.ref,
        message: "Invalid JSON contract manifest",
      });
    }
  }
  return out;
}
