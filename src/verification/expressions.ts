import { z } from 'zod';

export type FormalValue = boolean | string | bigint | { [key: string]: FormalValue };
export type Expr =
  | { kind: 'var'; name: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'str'; value: string }
  | { kind: 'bigint'; value: string }
  | { kind: 'field'; obj: Expr; field: string }
  | { kind: 'unop'; op: string; expr: Expr }
  | { kind: 'binop'; op: string; left: Expr; right: Expr };

/** Restricted consumption of LemmaScript's public typed IR, not a new source DSL. */
export const expressionSchema: z.ZodType<Expr> = z.lazy(() => z.discriminatedUnion('kind', [
  z.looseObject({ kind: z.literal('var'), name: z.string() }),
  z.looseObject({ kind: z.literal('bool'), value: z.boolean() }),
  z.looseObject({ kind: z.literal('str'), value: z.string() }),
  z.looseObject({ kind: z.literal('bigint'), value: z.string().max(4096).regex(/^-?\d+$/) }),
  z.looseObject({ kind: z.literal('field'), obj: expressionSchema, field: z.string() }),
  z.looseObject({ kind: z.literal('unop'), op: z.enum(['!', '-', '+']), expr: expressionSchema }),
  z.looseObject({ kind: z.literal('binop'), op: z.enum(['&&', '||', '==>', '===', '!==', '==', '!=', '>', '>=', '<', '<=', '+', '-']), left: expressionSchema, right: expressionSchema }),
]));

export function evaluateExpression(node: Expr, values: Record<string, FormalValue>): FormalValue {
  if (node.kind === 'var') {
    if (!Object.hasOwn(values, node.name)) throw new Error(`Unknown formal value: ${node.name}`);
    return values[node.name]!;
  }
  if (node.kind === 'bool' || node.kind === 'str') return node.value;
  if (node.kind === 'bigint') return BigInt(node.value);
  if (node.kind === 'field') {
    const object = evaluateExpression(node.obj, values);
    if (typeof object !== 'object' || !Object.hasOwn(object, node.field)) throw new Error('Invalid formal field access');
    return object[node.field]!;
  }
  if (node.kind === 'unop') {
    const value = evaluateExpression(node.expr, values);
    if (node.op === '!' && typeof value === 'boolean') return !value;
    if (node.op === '-' && typeof value === 'bigint') return -value;
    if (node.op === '+' && typeof value === 'bigint') return value;
    throw new Error('Unsupported unary formal operation');
  }
  const a = evaluateExpression(node.left, values), b = evaluateExpression(node.right, values);
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    if (node.op === '&&') return a && b;
    if (node.op === '||') return a || b;
    if (node.op === '==>') return !a || b;
  }
  if (typeof a !== 'object' && typeof a === typeof b) {
    if (node.op === '===' || node.op === '==') return a === b;
    if (node.op === '!==' || node.op === '!=') return a !== b;
  }
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    switch (node.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '>': return a > b;
      case '>=': return a >= b;
      case '<': return a < b;
      case '<=': return a <= b;
    }
  }
  throw new Error('Unsupported or mismatched formal operation');
}
