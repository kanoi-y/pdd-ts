import { describe, expect, it } from 'vitest';
import { compareSpecs } from '../../src/requirements/diff.js';
import type { SpecSnapshot } from '../../src/requirements/snapshot.js';
const base = (): SpecSnapshot => ({ schemaVersion: 1, digest: 'a'.repeat(64), complete: true, errors: [], metadata: { config: { schemaVersion: 1, tools: {}, approvedAssumptions: [], targets: [], testTargets: [], boundaries: [] }, modelConfig: {}, requirements: [{ id: 'SPEC-001', revision: 1, title: 'Spec', intent: 'Intent', risk: 'high', target: {file:'src/a.ts',symbol:'f'}, contracts: [], acceptance: [], trustedBoundaries: [] }], obligations: [{id:'proof', requirementIds:['SPEC-001'],kind:'test',scope:'tests',contractIds:[]}] }, contracts: [{scope:'src/a.ts#f', declaration:{signature:'function f(): boolean',contract:['ensures result'],requires:[],ensures:['result'],decreases:null}}] });
describe('SPEC-003 protected specification transitions', () => {
  it('does not require another approval when the complete snapshot is unchanged', () => { expect(compareSpecs(base(),base())).toMatchObject({changed:false, valid:true}); });
  it('requires a revision bump for every affected requirement including unreferenced premises', () => {
    const before=base(), after=base(); after.digest='b'.repeat(64); after.contracts[0]!.declaration.requires.push('false');
    expect(compareSpecs(before,after)).toMatchObject({changed:true, valid:false, affectedRequirements:['SPEC-001']});
    after.metadata.requirements[0]!.revision=2;
    expect(compareSpecs(before,after)).toMatchObject({changed:true, valid:true});
  });
  it('reports deletions and policy changes instead of silently losing obligations', () => {
    const before=base(), after=base(); after.digest='b'.repeat(64); after.metadata.obligations=[]; after.metadata.config.approvedAssumptions=['unsafe'];
    const diff=compareSpecs(before,after); expect(diff.deletedObligations).toEqual(['proof']); expect(diff.policyChanged).toBe(true); expect(diff.valid).toBe(false);
  });
  it('rejects incomplete snapshots and decreasing revisions even with unchanged human text', () => {
    const a=base(), b=base(); a.metadata.requirements[0]!.revision=2;
    expect(compareSpecs(a,b).valid).toBe(false); b.complete=false; expect(compareSpecs(b,b).valid).toBe(false);
  });
});
