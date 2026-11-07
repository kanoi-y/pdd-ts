import { z } from 'zod';
import { split } from './domain/split.js';

// Bound conversion work and accept ASCII decimal digits only, without coercion.
const decimalUnits = z.string().min(1).max(256).refine(value => !/[^0-9]/.test(value));
const inputSchema = z.strictObject({ total: decimalUnits, requested: decimalUnits });

export type SplitResult =
  | { ok: true; shares: { first: string; second: string } }
  | { ok: false };

/** Runtime boundary: validate unknown input before establishing the callee's premises. */
export function splitDecimal(input: unknown): SplitResult {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const shares = split(BigInt(parsed.data.total), BigInt(parsed.data.requested));
  return {
    ok: true,
    shares: { first: shares.first.toString(), second: shares.second.toString() },
  };
}
