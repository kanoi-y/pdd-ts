import type { z } from 'zod';
import type { evidenceSchema, gateContextSchema, obligationSchema } from '../requirements/schema.js';

export type EvidenceRecord = z.infer<typeof evidenceSchema>;
export type Obligation = z.infer<typeof obligationSchema>;
export type GateContext = z.infer<typeof gateContextSchema>;
export interface GateFinding {
  obligationId?: string;
  code: string;
  message: string;
}
export interface GateResult {
  status: 'passed' | 'blocked' | 'trial';
  satisfied: string[];
  findings: GateFinding[];
}
