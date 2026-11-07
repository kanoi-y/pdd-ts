import { z } from 'zod';
import { evidenceSchema, gateContextSchema, obligationsSchema } from '../requirements/schema.js';
import { canAcceptEvidence } from './acceptance.js';
import type { GateResult } from './types.js';

/** Context is supplied by the validating orchestrator, never read from an evidence receipt. */
export function evaluateGate(rawObligations: unknown, rawEvidence: unknown, rawContext: unknown): GateResult {
  const obligations = obligationsSchema.safeParse(rawObligations);
  const evidence = z.array(evidenceSchema).max(10000).safeParse(rawEvidence);
  const context = gateContextSchema.safeParse(rawContext);
  const result: GateResult = { status: 'blocked', satisfied: [], findings: [] };
  if (!obligations.success || !evidence.success || !context.success) {
    result.findings.push({ code: 'invalid-data', message: 'Invalid obligations, evidence or trusted evaluation context' });
    return result;
  }
  if (obligations.data.length === 0) {
    result.findings.push({ code: 'empty-obligations', message: 'An empty required verification set cannot pass' });
    return result;
  }
  const ctx = context.data;
  const current = evidence.data.filter(item => item.run.id === ctx.runId);
  const expected = new Set(obligations.data.map(item => item.id));
  if (new Set(current.map(item => item.id)).size !== current.length) {
    result.findings.push({ code: 'duplicate-evidence-id', message: 'Current evidence IDs must be unique' });
  }
  for (const item of current) {
    if (!expected.has(item.obligationId)) {
      result.findings.push({ obligationId: item.obligationId, code: 'unexpected-evidence', message: 'Evidence is outside the required verification set' });
    }
  }
  for (const obligation of obligations.data) {
    const candidates = current.filter(item => item.obligationId === obligation.id);
    const item = candidates[0];
    if (candidates.length !== 1 || !item) {
      result.findings.push({ obligationId: obligation.id, code: candidates.length ? 'duplicate' : 'missing', message: 'Exactly one current result is required' });
      continue;
    }
    const complete = obligation.kind !== 'source-proof' || (
      obligation.contractIds.every(id => item.verifiedContractIds.includes(id)) &&
      item.verifiedSymbols.includes(obligation.scope.slice(obligation.scope.lastIndexOf('#') + 1)) &&
      item.premiseEvidenceIds.length > 0
    );
    const scoped = item.kind === obligation.kind && item.scope === obligation.scope &&
      obligation.requirementIds.every(id => item.requirementIds.includes(id));
    const counts = item.counts;
    const testsComplete = item.kind !== 'test' || Boolean(counts && counts.total > 0 &&
      counts.passed === counts.total && counts.failed === 0 && counts.skipped === 0);
    const reviewComplete = !['manual-review', 'trusted-contract'].includes(item.kind) || Boolean(item.reviewId);
    const successful = item.status === 'passed' && testsComplete && reviewComplete &&
      item.assumptions.every(assumption => ctx.approvedAssumptions.includes(assumption));
    const expectedSource = ctx.expectedSourceDigests ? ctx.expectedSourceDigests[obligation.id] : ctx.sourceDigest;
    const fresh = item.sourceDigest === expectedSource && item.specDigest === ctx.specDigest && item.toolchainDigest === ctx.toolchainDigest &&
      (ctx.commit === undefined || item.commit === ctx.commit);
    const authentic = ctx.mode === 'trial' || (item.run.origin === 'ci' && ctx.authenticatedRunId === ctx.runId);
    const approved = ctx.mode === 'trial' || ctx.approval === 'approved';
    if (canAcceptEvidence(complete, scoped, successful, fresh, authentic, approved)) {
      result.satisfied.push(obligation.id);
    } else {
      for (const [ok, code] of [
        [complete, 'incomplete-proof'], [scoped, 'scope-mismatch'], [successful, 'unsatisfied'],
        [fresh, 'stale'], [authentic, 'unauthenticated-run'], [approved, 'unapproved'],
      ] as const) {
        if (!ok) result.findings.push({ obligationId: obligation.id, code, message: `Required evidence check failed: ${code}` });
      }
    }
  }
  if (result.findings.length === 0) result.status = ctx.mode === 'trial' ? 'trial' : 'passed';
  return result;
}
