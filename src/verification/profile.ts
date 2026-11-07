import { Project, ts } from 'ts-morph';

export type ParameterDomain = { kind: 'boolean' } | { kind: 'bigint' } | { kind: 'literal'; values: string[] };
export interface ProfileResult { reasons: string[]; domains: Record<string, ParameterDomain> }

const permitted = new Set([
  ts.SyntaxKind.SourceFile, ts.SyntaxKind.EndOfFileToken, ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.Parameter, ts.SyntaxKind.Identifier,
  ts.SyntaxKind.BooleanKeyword, ts.SyntaxKind.BigIntKeyword, ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.BigIntLiteral, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.UnionType, ts.SyntaxKind.LiteralType, ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.TypeReference, ts.SyntaxKind.TypeLiteral, ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.Block, ts.SyntaxKind.ReturnStatement, ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ParenthesizedExpression, ts.SyntaxKind.BinaryExpression, ts.SyntaxKind.PrefixUnaryExpression,
  ts.SyntaxKind.ObjectLiteralExpression, ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.ExclamationToken,
]);

export function inspectProfile(source: string, filename: string, symbol: string): ProfileResult {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
    skipLibCheck: true, noEmit: true, types: [],
  } });
  const file = project.createSourceFile(filename, source).compilerNode;
  const reasons: string[] = [];
  const domains: Record<string, ParameterDomain> = {};
  const aliases = new Map(file.statements.filter(ts.isTypeAliasDeclaration).map(node => [node.name.text, node.type]));
  const resolveDomain = (type: ts.TypeNode | undefined, seen = new Set<string>()): ParameterDomain | undefined => {
    if (!type) return undefined;
    if (type.kind === ts.SyntaxKind.BooleanKeyword) return { kind: 'boolean' };
    if (type.kind === ts.SyntaxKind.BigIntKeyword) return { kind: 'bigint' };
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && !seen.has(type.typeName.text)) {
      const next = new Set(seen); next.add(type.typeName.text);
      return resolveDomain(aliases.get(type.typeName.text), next);
    }
    const nodes = ts.isUnionTypeNode(type) ? type.types : [type];
    if (nodes.every(node => ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal))) {
      return { kind: 'literal', values: nodes.map(node => (node as ts.LiteralTypeNode & { literal: ts.StringLiteral }).literal.text) };
    }
    return undefined;
  };
  const functions = file.statements.filter(ts.isFunctionDeclaration).filter(node => node.name?.text === symbol);
  if (functions.length !== 1 || !functions[0]?.body) reasons.push('Expected exactly one implemented named function');
  const fn = functions[0];
  if (fn) {
    for (const param of fn.parameters) {
      const domain = resolveDomain(param.type);
      if (!ts.isIdentifier(param.name) || !domain || param.questionToken || param.dotDotDotToken || param.initializer) {
        reasons.push('Parameters require supported explicit primitive domains, without optional/rest/default binding');
      } else domains[param.name.text] = domain;
    }
  }
  for (const annotation of source.matchAll(/^\s*\/\/@\s*(\w+)/gm)) {
    if (!['contract', 'requires', 'ensures'].includes(annotation[1]!)) reasons.push(`Unsupported annotation: ${annotation[1]}`);
  }
  const visit = (node: ts.Node): void => {
    if (!permitted.has(node.kind)) reasons.push(`Unsupported TypeScript syntax: ${ts.SyntaxKind[node.kind]}`);
    if (ts.isIdentifier(node) && ['undefined', 'NaN', 'Infinity', '__proto__', 'prototype', 'constructor'].includes(node.text)) reasons.push(`Unsupported identifier: ${node.text}`);
    if (ts.isFunctionDeclaration(node) && (!node.body || node.asteriskToken || node.typeParameters?.length)) reasons.push('External, generator and generic functions are unsupported');
    if (ts.isFunctionDeclaration(node) && !ts.isSourceFile(node.parent)) reasons.push('Nested function declarations are unsupported');
    if (ts.isStringLiteral(node) && ['__proto__', 'prototype', 'constructor'].includes(node.text) &&
        (ts.isPropertyAssignment(node.parent) || ts.isPropertySignature(node.parent))) reasons.push('Prototype-sensitive record keys are unsupported');
    if (ts.isPrefixUnaryExpression(node) && ![ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.MinusToken].includes(node.operator)) reasons.push('Unsupported unary runtime operation');
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (reasons.length === 0) {
    const errors = project.getPreEmitDiagnostics().filter(item => item.getCategory() === ts.DiagnosticCategory.Error);
    if (errors.length) reasons.push(...errors.slice(0, 5).map(item => `TypeScript typecheck failed: ${ts.flattenDiagnosticMessageText(item.compilerObject.messageText, ' ')}`));
    const checker = project.getTypeChecker().compilerObject;
    const hasType = (type: ts.Type, flag: ts.TypeFlags): boolean => type.isUnion() ? type.types.every(part => hasType(part, flag)) : Boolean(type.flags & flag);
    const bigint = (node: ts.Node): boolean => hasType(checker.getTypeAtLocation(node), ts.TypeFlags.BigIntLike);
    const boolean = (node: ts.Node): boolean => hasType(checker.getTypeAtLocation(node), ts.TypeFlags.BooleanLike);
    const primitivePair = (left: ts.Node, right: ts.Node): boolean => [ts.TypeFlags.BigIntLike, ts.TypeFlags.BooleanLike, ts.TypeFlags.StringLike].some(flag => hasType(checker.getTypeAtLocation(left), flag) && hasType(checker.getTypeAtLocation(right), flag));
    const checkSemantics = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node)) {
        const operator = node.operatorToken.kind;
        if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(operator) && (!bigint(node.left) || !bigint(node.right))) reasons.push('Arithmetic and ordered comparisons require bigint operands in this profile');
        if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(operator) && (!boolean(node.left) || !boolean(node.right))) reasons.push('Logical runtime operations require boolean operands');
        if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(operator) && !primitivePair(node.left, node.right)) reasons.push('Runtime equality requires matching supported primitive operands');
      }
      if (ts.isPrefixUnaryExpression(node) && ((node.operator === ts.SyntaxKind.MinusToken && !bigint(node.operand)) || (node.operator === ts.SyntaxKind.ExclamationToken && !boolean(node.operand)))) reasons.push('Unsupported operand for unary runtime operation');
      if (ts.isIfStatement(node) && !boolean(node.expression)) reasons.push('Branches require boolean conditions');
      ts.forEachChild(node, checkSemantics);
    };
    checkSemantics(file);
  }
  return { reasons: [...new Set(reasons)], domains };
}
