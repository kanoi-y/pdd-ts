import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canAcceptEvidence } from '../../src/verification/acceptance.js';
import { evaluateGate } from '../../src/verification/gate.js';
import { evidenceSchema, obligationsSchema } from '../../src/requirements/schema.js';

const digest = 'a'.repeat(64);
const obligation = {
  id: 'auth-proof', requirementIds: ['AUTH-001'], kind: 'source-proof',
  scope: 'src/auth.ts#canIssueAdminToken', contractIds: ['AUTH-001-C1'],
};
const context = {
  runId: 'run-1', sourceDigest: digest, specDigest: digest, toolchainDigest: digest,
  approval: 'approved', mode: 'ci', authenticatedRunId: 'run-1',
} as const;
const evidence = {
  id: 'ev-1', obligationId: 'auth-proof', requirementIds: ['AUTH-001'], kind: 'source-proof',
  status: 'passed', scope: obligation.scope, assumptions: [], artifactPaths: ['proof.log'],
  artifactDigests: { 'proof.log': digest }, verifiedSymbols: ['canIssueAdminToken'],
  verifiedContractIds: ['AUTH-001-C1'], premiseEvidenceIds: ['witness-1'],
  proofInputDigest: digest, sourceDigest: digest, specDigest: digest, toolchainDigest: digest,
  commit: 'b'.repeat(40), run: { id: 'run-1', origin: 'ci', workflowIdentity: 'org/repo/.github/workflows/pdd.yml@main' },
};

describe('CORE-001: accept evidence only when every condition holds', () => {
  it('accepts exactly the one all-true row of the six-condition truth table', () => {
    for (let mask = 0; mask < 64; mask++) {
      expect(canAcceptEvidence(
        Boolean(mask & 1), Boolean(mask & 2), Boolean(mask & 4),
        Boolean(mask & 8), Boolean(mask & 16), Boolean(mask & 32),
      )).toBe(mask === 63);
    }
  });

  it('passes a complete current authenticated approved proof', () => {
    expect(evaluateGate([obligation], [evidence], context)).toMatchObject({ status: 'passed', satisfied: ['auth-proof'], findings: [] });
  });

  it('blocks an empty required set, even when every supplied evidence item passed', () => {
    expect(evaluateGate([], [], context)).toMatchObject({ status: 'blocked' });
  });

  it('blocks a required item missing from the current run', () => {
    const result = evaluateGate([obligation], [], context);
    expect(result.status).toBe('blocked');
    expect(result.findings).toContainEqual(expect.objectContaining({ obligationId: 'auth-proof', code: 'missing' }));
  });

  it('does not use an older success when the current run has no result', () => {
    expect(evaluateGate([obligation], [{ ...evidence, run: { ...evidence.run, id: 'old-run' } }], context).status).toBe('blocked');
  });

  it.each(['failed', 'unsupported', 'unknown', 'not-run', 'stale', 'error'])('blocks required proof status %s', status => {
    expect(evaluateGate([obligation], [{ ...evidence, status }], context).status).toBe('blocked');
  });

  it.each(['kind', 'scope', 'requirementIds', 'verifiedContractIds', 'verifiedSymbols'])('rejects a mismatched %s', field => {
    const wrong: Record<string, unknown> = { kind: 'test', scope: 'other.ts#other', requirementIds: ['OTHER-001'], verifiedContractIds: [], verifiedSymbols: [] };
    expect(evaluateGate([obligation], [{ ...evidence, [field]: wrong[field] }], context).status).toBe('blocked');
  });

  it.each(['sourceDigest', 'specDigest', 'toolchainDigest'])('rejects an obsolete %s', field => {
    expect(evaluateGate([obligation], [{ ...evidence, [field]: 'c'.repeat(64) }], context).status).toBe('blocked');
  });

  it('rejects duplicate current evidence instead of selecting the passing one', () => {
    expect(evaluateGate([obligation], [evidence, { ...evidence, id: 'ev-2', status: 'failed' }], context).status).toBe('blocked');
  });

  it('rejects duplicate obligation IDs rather than silently coalescing them', () => {
    expect(evaluateGate([obligation, obligation], [evidence], context).status).toBe('blocked');
  });

  it('does not accept a self-reported CI run when external authentication is absent', () => {
    const { authenticatedRunId: _, ...unauthenticated } = context;
    expect(evaluateGate([obligation], [evidence], unauthenticated).status).toBe('blocked');
  });

  it.each(['pending', 'invalid'])('blocks %s approval regardless of proof success', approval => {
    expect(evaluateGate([obligation], [evidence], { ...context, approval }).status).toBe('blocked');
  });

  it('labels a locally successful run as a trial, never a protected CI pass', () => {
    expect(evaluateGate([obligation], [{ ...evidence, run: { id: 'run-1', origin: 'local' } }], { ...context, mode: 'trial', approval: 'pending' }).status).toBe('trial');
  });

  it('blocks zero-case, skipped or internally inconsistent test reports', () => {
    const testObligation = { ...obligation, id: 'auth-tests', kind: 'test', contractIds: [] };
    for (const counts of [
      { total: 0, passed: 0, failed: 0, skipped: 0 },
      { total: 3, passed: 2, failed: 0, skipped: 1 },
      { total: 3, passed: 3, failed: 1, skipped: 0 },
    ]) {
      expect(evaluateGate([testObligation], [{ ...evidence, obligationId: 'auth-tests', kind: 'test', counts }], context).status).toBe('blocked');
    }
    expect(evaluateGate([testObligation], [{ ...evidence, obligationId: 'auth-tests', kind: 'test', counts: { total: 3, passed: 3, failed: 0, skipped: 0 } }], context).status).toBe('passed');
  });

  it('does not accept an unapproved extra trust assumption', () => {
    expect(evaluateGate([obligation], [{ ...evidence, assumptions: ['external is correct'] }], context).status).toBe('blocked');
  });

  it('never passes a missing obligation under arbitrary surrounding successes', () => {
    fc.assert(fc.property(fc.array(fc.string({ minLength: 1 }), { maxLength: 20 }), ids => {
      const extras = ids.map((id, index) => ({ ...evidence, id: `extra-${index}`, obligationId: `other-${id}` }));
      expect(evaluateGate([obligation], extras, context).status).toBe('blocked');
    }));
  });

  it('rejects malformed evidence and unknown fields instead of ignoring them', () => {
    expect(evidenceSchema.safeParse({ ...evidence, status: 'success' }).success).toBe(false);
    expect(evidenceSchema.safeParse({ ...evidence, injected: true }).success).toBe(false);
    expect(obligationsSchema.safeParse([obligation, obligation]).success).toBe(false);
  });

  it('uses independently computed per-obligation source digests and rejects absent map entries', () => {
    const other = { ...obligation, id: 'other-proof', scope: 'src/other.ts#other' };
    const otherEvidence = { ...evidence, id: 'ev-2', obligationId: 'other-proof', scope: other.scope, verifiedSymbols: ['other'], sourceDigest: 'd'.repeat(64) };
    const mapped = { ...context, expectedSourceDigests: { 'auth-proof': digest, 'other-proof': 'd'.repeat(64) } };
    expect(evaluateGate([obligation, other], [evidence, otherEvidence], mapped).status).toBe('passed');
    expect(evaluateGate([obligation, other], [evidence, otherEvidence], { ...mapped, expectedSourceDigests: { 'auth-proof': digest } }).status).toBe('blocked');
  });

  it('does not accept a result from a different checkout commit', () => {
    expect(evaluateGate([obligation], [evidence], { ...context, commit: 'e'.repeat(40) }).status).toBe('blocked');
  });
});
