import {describe,expect,it} from 'vitest';
import {inspectProtection} from '../../src/ci/doctor.js';
const policy={context:'PDD protected gate',appId:42,minApprovals:1};
const protection={enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:[{context:policy.context,app_id:42}]},required_pull_request_reviews:{dismiss_stale_reviews:true,required_approving_review_count:1,require_code_owner_reviews:true}};
describe('CI-004 protected repository doctor',()=>{
 it('accepts only required strict checks with the expected issuer and enforced stale reviews',()=>expect(inspectProtection(protection,policy)).toEqual([]));
 it('rejects a same-name check from the wrong app and a removable review policy',()=>{
  expect(inspectProtection({...protection,required_status_checks:{strict:true,checks:[{context:policy.context,app_id:7}]}},policy).length).toBeGreaterThan(0);
  expect(inspectProtection({...protection,enforce_admins:{enabled:false}},policy).length).toBeGreaterThan(0);
  expect(inspectProtection({...protection,required_pull_request_reviews:{dismiss_stale_reviews:false,required_approving_review_count:1}},policy).length).toBeGreaterThan(0);
 });
 it('distinguishes unavailable protection data from ready',()=>expect(inspectProtection({},policy).length).toBeGreaterThan(0));
});

it('CI-004 rejects the shared Actions issuer even when a same-name check is required',()=>{
 const shared={...protection,required_status_checks:{strict:true,checks:[{context:policy.context,app_id:15368}]}};
 expect(inspectProtection(shared,{...policy,appId:15368}).join(' ')).toMatch(/dedicated|shared|issuer/i);
});

import {inspectPublisherEnvironment} from '../../src/ci/doctor.js';
it('CI-004 requires publisher credentials confined to the exact default branch',()=>{
 const environment={deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}};
 const policies={branch_policies:[{name:'main',type:'branch'}]};
 expect(inspectPublisherEnvironment(environment,policies,'main')).toEqual([]);
 expect(inspectPublisherEnvironment(environment,{branch_policies:[{name:'*',type:'branch'}]},'main').length).toBeGreaterThan(0);
 expect(inspectPublisherEnvironment(environment,{branch_policies:[{name:'main',type:'tag'}]},'main').length).toBeGreaterThan(0);
 expect(inspectPublisherEnvironment({},policies,'main').length).toBeGreaterThan(0);
});
