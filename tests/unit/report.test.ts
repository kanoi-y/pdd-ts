import {expect,it} from 'vitest';
import {renderMarkdown} from '../../src/reporter/markdown.js';
import type {ReviewPacket} from '../../src/cli/runs.js';
it('CLI-003 exposes runtime trust assumptions alongside the proof scope',()=>{
 const packet:ReviewPacket={schemaVersion:1,runId:'report-run',createdAt:'2026-11-07T00:00:00Z',commit:'a'.repeat(40),dirty:false,origin:'local',approval:'pending',specDigest:'b'.repeat(64),recordedSpecDigest:'b'.repeat(64),snapshotComplete:true,gate:{status:'trial',satisfied:[],findings:[]},evidence:[],requirements:[],unverifiedRequirements:[],diagnostics:[],allowedAssumptions:['profile:pdd-pure-v1','identity-provider:authentic-server-session'],boundaries:[{id:'IDP-TRUST',callerFiles:['src/route.ts'],validatorFiles:['src/input.ts'],calleeScope:'src/auth.ts#canIssueAdminToken',testObligationIds:['route-test'],assumption:'identity-provider:authentic-server-session'}]};
 const markdown=renderMarkdown(packet);
 for(const value of ['IDP-TRUST','identity-provider:authentic-server-session','src/route.ts','src/input.ts','route-test','External facts remain trusted'])expect(markdown).toContain(value);
 expect(markdown).toContain('Approval: pending');
});
