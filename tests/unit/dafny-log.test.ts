import { describe, expect, it } from 'vitest';
import { evaluateDafnyAudit, evaluateDafnyLog } from '../../src/verification/dafny-log.js';

const verified = '\nResults for auth_ensures (correctness)\n  Overall outcome: Correct\n  Overall time: 00:00:00.01\n';
describe('CORE-003: account for the expected proof member', () => {
  it('accepts the actual member log format observed from the pinned verifier', () => {
    expect(evaluateDafnyLog(verified, 'auth_ensures')).toBe('verified');
  });
  it('does not confuse zero work or helper-only work with the required source contract', () => {
    expect(evaluateDafnyLog('', 'auth_ensures')).toBe('unknown');
    expect(evaluateDafnyLog(verified, 'other_ensures')).toBe('unknown');
    expect(evaluateDafnyLog(verified, 'auth')).toBe('unknown');
  });
  it('rejects failure in any check of a member even when correctness passed', () => {
    const failed = verified + '\nResults for auth_ensures (well-formedness)\n  Overall outcome: Errors\n';
    expect(evaluateDafnyLog(failed, 'auth_ensures')).toBe('failed');
  });
  it('rejects partially parsed member logs rather than silently dropping malformed entries', () => {
    expect(evaluateDafnyLog(verified + '\nResults for another (correctness)\n  missing outcome\n', 'auth_ensures')).toBe('unknown');
  });
  it('reads the auditor summary instead of treating zero exit or a quoted zero as clean', () => {
    expect(evaluateDafnyAudit('Dafny auditor completed with 0 findings\n')).toBe('clean');
    expect(evaluateDafnyAudit('Dafny auditor completed with 1 findings\n')).toBe('findings');
    expect(evaluateDafnyAudit('warning mentions "Dafny auditor completed with 0 findings"\nDafny auditor completed with 1 findings\n')).toBe('findings');
    expect(evaluateDafnyAudit('')).toBe('unknown');
    expect(evaluateDafnyAudit('Dafny auditor completed with 0 findings\nDafny auditor completed with 1 findings\n')).toBe('unknown');
  });
});
