import ts from "typescript-parser";
import { posix } from "node:path";
export function analyzeImpact(
  files: Readonly<Record<string, string>>,
  changed: readonly string[],
  mappings: Readonly<Record<string, readonly string[]>>,
) {
  const dependencies = new Map<string, Set<string>>();
  const unknown: string[] = [];
  const calls: {
    file: string;
    callee: string;
  }[] = [];
  for (const [path, source] of Object.entries(files)) {
    const f = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const deps = new Set<string>();
    dependencies.set(path, deps);
    const knownCalls = new Set<string>(["require"]);
    const scan = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name) knownCalls.add(n.name.text);
      if (ts.isImportSpecifier(n)) knownCalls.add(n.name.text);
      if (ts.isImportClause(n) && n.name) knownCalls.add(n.name.text);
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        (ts.isArrowFunction(n.initializer) ||
          ts.isFunctionExpression(n.initializer)) &&
        ts.isVariableDeclarationList(n.parent) &&
        (n.parent.flags & ts.NodeFlags.Const) !== 0
      )
        knownCalls.add(n.name.text);
      ts.forEachChild(n, scan);
    };
    scan(f);
    const resolve = (specifier: string) => {
      if (!specifier.startsWith(".")) {
        unknown.push(`${path}: external dependency ${specifier}`);
        return;
      }
      const base = posix.normalize(posix.join(posix.dirname(path), specifier));
      const target = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
      ].find((p) => Object.hasOwn(files, p));
      if (target) deps.add(target);
      else unknown.push(`${path}: unresolved ${specifier}`);
    };
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        n.expression.kind !== ts.SyntaxKind.ImportKeyword
      ) {
        if (ts.isIdentifier(n.expression)) {
          calls.push({ file: path, callee: n.expression.text });
          if (!knownCalls.has(n.expression.text))
            unknown.push(`${path}: unresolved call ${n.expression.text}`);
        } else if (ts.isPropertyAccessExpression(n.expression)) {
          calls.push({ file: path, callee: n.expression.getText(f) });
          unknown.push(`${path}: unresolved member call`);
        } else unknown.push(`${path}: computed or indirect call`);
      }
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier))
        resolve(n.moduleSpecifier.text);
      if (
        ts.isExportDeclaration(n) &&
        n.moduleSpecifier &&
        ts.isStringLiteral(n.moduleSpecifier)
      )
        resolve(n.moduleSpecifier.text);
      if (
        ts.isCallExpression(n) &&
        n.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        if (n.arguments[0] && ts.isStringLiteral(n.arguments[0]))
          resolve(n.arguments[0].text);
        else unknown.push(`${path}: dynamic import`);
      }
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "require"
      ) {
        if (n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]!))
          resolve(n.arguments[0]!.text);
        else unknown.push(`${path}: dynamic require`);
      }
      ts.forEachChild(n, visit);
    };
    visit(f);
  }
  const affected = new Set(changed);
  let again = true;
  while (again) {
    again = false;
    for (const [p, deps] of dependencies)
      if (!affected.has(p) && [...deps].some((d) => affected.has(d))) {
        affected.add(p);
        again = true;
      }
  }
  const contractIds = [
    ...new Set([...affected].flatMap((p) => mappings[p] ?? [])),
  ].sort();
  return {
    status: unknown.length ? "unknown" : "pass",
    affectedFiles: [...affected].sort(),
    contractIds,
    calls: calls.sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.callee.localeCompare(b.callee),
    ),
    unknown: unknown.sort(),
  };
}
