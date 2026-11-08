import {expect,it} from 'vitest';
import {renderMarkdown} from '../../src/reporter/markdown.js';
import type {ReviewPacket} from '../../src/cli/runs.js';
import type {EvidenceRecord,Obligation} from '../../src/verification/types.js';

const requirement:ReviewPacket['requirements'][number]={
 id:'AUTH-001',revision:1,title:'管理者向け操作の利用条件',
 intent:'サーバーが確認した本人情報を使い、管理者で認証済みの場合だけ操作を許可する。',risk:'high',
 target:{file:'src/auth.ts',symbol:'canIssueAdminToken'},
 contracts:[
  {id:'AUTH-C1',kind:'postcondition',human:'管理者かつ認証成功の場合だけ許可する。',sourceRef:{file:'src/auth.ts',symbol:'canIssueAdminToken',clause:'ensures',index:0},semantics:'boolean-string-equality-v1'},
  {id:'AUTH-C2',kind:'postcondition',human:'セッションの有効期限も検査する。',sourceRef:{file:'src/auth.ts',symbol:'canIssueAdminToken',clause:'ensures',index:1},semantics:'separate-unverified-property'},
 ],acceptance:[],trustedBoundaries:['IDP-TRUST'],
};
function evidence(kind:'source-proof'|'test'):EvidenceRecord {
 const obligationId=kind==='source-proof'?'auth-proof':'route-test';
 const artifact='.pdd/evidence/report-run/'+obligationId+'/result.json';
 return {id:obligationId,obligationId,requirementIds:['AUTH-001'],kind,status:'passed',
  scope:kind==='source-proof'?'src/auth.ts#canIssueAdminToken':'POST /decision',assumptions:kind==='source-proof'?['profile:pdd-pure-v1']:[],
  artifactPaths:[artifact],artifactDigests:{[artifact]:'c'.repeat(64)},verifiedSymbols:kind==='source-proof'?['canIssueAdminToken']:[],
  verifiedContractIds:kind==='source-proof'?['AUTH-C1']:[],premiseEvidenceIds:kind==='source-proof'?['witness']:[],
  proofInputDigest:'c'.repeat(64),sourceDigest:'d'.repeat(64),specDigest:'b'.repeat(64),toolchainDigest:'e'.repeat(64),commit:'a'.repeat(40),run:{id:'report-run',origin:'local'},
  ...(kind==='test'?{counts:{total:24,passed:24,failed:0,skipped:0}}:{}),
 };
}
function packet():ReviewPacket&{obligations:Obligation[]} {
 return {schemaVersion:1,runId:'report-run',createdAt:'2026-11-07T00:00:00Z',commit:'a'.repeat(40),dirty:false,
  origin:'local',approval:'pending',specDigest:'b'.repeat(64),recordedSpecDigest:'b'.repeat(64),snapshotComplete:true,
  gate:{status:'trial',satisfied:['auth-proof','route-test'],findings:[]},evidence:[evidence('source-proof'),evidence('test')],requirements:[structuredClone(requirement)],
  obligations:[{id:'auth-proof',requirementIds:['AUTH-001'],kind:'source-proof',scope:'src/auth.ts#canIssueAdminToken',contractIds:['AUTH-C1']},{id:'route-test',requirementIds:['AUTH-001'],kind:'test',scope:'POST /decision',contractIds:[]}],
  sourceContracts:[{scope:'src/auth.ts#canIssueAdminToken',declaration:{signature:'(role: string, passwordOk: boolean): boolean',contract:[],requires:[],ensures:['\\result === (role === \"admin\" && passwordOk)'],decreases:null}}],
  unverifiedRequirements:[],diagnostics:[],allowedAssumptions:['profile:pdd-pure-v1','identity-provider:authentic-server-session'],
  boundaries:[{id:'IDP-TRUST',callerFiles:['src/route.ts'],validatorFiles:['src/input.ts'],calleeScope:'src/auth.ts#canIssueAdminToken',testObligationIds:['route-test'],assumption:'identity-provider:authentic-server-session'}],
 };
}
const overview=(markdown:string)=>markdown.split('<details>')[0]!;

it('CLI-003 exposes runtime trust assumptions alongside the proof scope',()=>{
 const markdown=renderMarkdown(packet());
 for(const value of ['IDP-TRUST','identity-provider:authentic-server-session','src/route.ts','src/input.ts','route-test'])expect(markdown).toContain(value);
 expect(markdown).toContain('本人承認');
});
it('CLI-003 returns missing test evidence to the developer before requesting human approval',()=>{
 const p=packet();p.gate={status:'blocked',satisfied:['auth-proof'],findings:[{obligationId:'route-test',code:'unsatisfied',message:'Required evidence check failed: unsatisfied'}]};
 p.evidence[1]!.status='unknown';p.evidence[1]!.counts={total:0,passed:0,failed:0,skipped:0};
 p.diagnostics=[{obligationId:'route-test',messages:['結果に含まれない必須テスト：session-expiry']}];
 const markdown=renderMarkdown(p),front=overview(markdown);
 expect(front).toContain('管理者向け操作の利用条件');expect(front).toContain(requirement.intent);
 expect(front).toContain('開発側');expect(front).toContain('テストの結果');expect(front).toContain('承認は求めません');
 expect(front).not.toContain(p.specDigest);expect(front).not.toContain('unsatisfied');
 expect(markdown).toContain('session-expiry');expect(markdown).toContain(p.evidence[1]!.artifactPaths[0]!.split('/').at(-1)!);
});
it('CLI-003 requires an explanation of unapproved trust instead of an opaque approval request',()=>{
 const p=packet();p.boundaries[0]!.assumption='identity-provider:additional-unreviewed-scope';
 p.gate={status:'blocked',satisfied:['auth-proof','route-test'],findings:[{code:'spec-incomplete',message:'Unapproved boundary assumption: IDP-TRUST'}]};
 const front=overview(renderMarkdown(p));
 expect(front).toContain('許可されていない');expect(front).toContain('変更内容・必要性・影響');expect(front).toContain('開発側');
 expect(front).toContain('承認は求めません');expect(front).not.toContain('identity-provider:additional-unreviewed-scope');
});
it('CLI-003 explains only verified contracts and keeps local success separate from CI approval',()=>{
 const p=packet(),front=overview(renderMarkdown(p));
 expect(front).toContain('手元の検証');expect(front).toContain('仕様の確認');
 expect(front).toContain('管理者かつ認証成功の場合だけ許可する。');
 expect(front).not.toContain('セッションの有効期限も検査する。');
 expect(front).toContain('外部');expect(front).not.toContain('CIの確認が完了');
 expect(renderMarkdown(p)).toContain('セッションの有効期限も検査する。');
});
it.each(['failed','unsupported','unknown','not-run','stale','error'] as const)('CLI-003 keeps proof status %s out of confirmed behavior',status=>{
 const p=packet();p.evidence[0]!.status=status;p.gate={status:'blocked',satisfied:['route-test'],findings:[{obligationId:'auth-proof',code:status==='stale'?'stale':'unsatisfied',message:'unaccepted proof'}]};
 const front=overview(renderMarkdown(p));
 expect(front).toContain('開発側');expect(front).toContain('承認は求めません');expect(front).not.toContain('管理者かつ認証成功の場合だけ許可する。');
});
it('CLI-003 retains missing obligations and unsafe authored text without inventing a passing result',()=>{
 const p=packet();p.gate={status:'blocked',satisfied:['auth-proof'],findings:[{obligationId:'route-test',code:'missing',message:'Exactly one current result is required'}]};p.evidence.pop();
 p.requirements[0]!.title='<script>alert(1)</script> [Approve](https://example.invalid)'+String.fromCharCode(0x202e);
 const markdown=renderMarkdown(p),front=overview(markdown);
 expect(front).toContain('開発側');expect(front).toContain('検証結果がありません');
 expect(markdown).not.toContain('<script>');expect(front).not.toContain('[Approve](https://example.invalid)');
 expect(markdown).toContain('route-test');expect(markdown).toContain('missing');
 expect(markdown).not.toContain(String.fromCharCode(0x202e));expect(markdown).not.toContain('&#8238;');
});
it('CLI-003 identifies completed authenticated CI only with the verified packet approval',()=>{
 const p=packet();p.origin='ci';p.approval='approved';p.gate.status='passed';
 const front=overview(renderMarkdown(p));
 expect(front).toContain('CIの出所の確認が完了');expect(front).toContain('本人承認は確認済み');
 expect(front).not.toContain('承認は求めません');
});
it('CLI-003 does not turn a local passed label into an authenticated CI claim',()=>{
 const p=packet();p.gate.status='passed';
 const front=overview(renderMarkdown(p));
 expect(front).toContain('仕様の確認');expect(front).not.toContain('CIの出所の確認が完了');
});
