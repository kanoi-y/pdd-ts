import {z} from 'zod';
import type {GitHubClient} from './github.js';
const protectionSchema=z.object({enforce_admins:z.object({enabled:z.boolean()}),required_status_checks:z.object({strict:z.boolean(),checks:z.array(z.object({context:z.string(),app_id:z.number().nullable()}))}),required_pull_request_reviews:z.object({dismiss_stale_reviews:z.boolean(),required_approving_review_count:z.number(),require_code_owner_reviews:z.boolean()})});
export function inspectProtection(raw:unknown,policy:{context:string;appId:number;minApprovals:number}):string[] {
 const parsed=protectionSchema.safeParse(raw); if(!parsed.success) return ['Required protection data unavailable or incomplete'];
 const p=parsed.data,errors:string[]=[];
 if(policy.appId===15368) errors.push('A dedicated check issuer is required; the shared GitHub Actions App is substitutable');
 if(!p.enforce_admins.enabled) errors.push('Administrators can bypass protection');
 if(!p.required_status_checks.strict) errors.push('Required status checks are not strict');
 if(!p.required_status_checks.checks.some(check=>check.context===policy.context && check.app_id===policy.appId)) errors.push('Expected required check issuer is missing');
 if(!p.required_pull_request_reviews.dismiss_stale_reviews || p.required_pull_request_reviews.required_approving_review_count<policy.minApprovals || !p.required_pull_request_reviews.require_code_owner_reviews) errors.push('Exact-head stale review and code-owner policy is insufficient');
 return errors;
}
export async function doctorGitHub(client:GitHubClient,repository:string,policy:{context:string;appId:number;minApprovals:number;repositoryId?:number;workflow?:string}) {
 try {
  const info=z.object({id:z.number().int().positive(),default_branch:z.string()}).parse(await client.get(`repos/${repository}`));
  // Use the repository's actual default branch; percent-encoding prevents route injection.
  const protection=await client.get(`repos/${repository}/branches/${encodeURIComponent(info.default_branch)}/protection`);
  const findings=inspectProtection(protection,policy);
  if(!policy.repositoryId || info.id!==policy.repositoryId) findings.push('Immutable repository identity does not match protected policy');
  if(!policy.workflow || !/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(policy.workflow)) findings.push('Trusted workflow path is missing or invalid');
  else {
    const workflow=z.object({path:z.string(),state:z.string()}).parse(await client.get(`repos/${repository}/actions/workflows/${policy.workflow.slice('.github/workflows/'.length)}`));
    if(workflow.path!==policy.workflow || workflow.state!=='active') findings.push('Trusted workflow is missing or inactive');
  }
  if(policy.appId!==15368) {
    const environment=await client.get(`repos/${repository}/environments/pdd-publisher`);
    const branches=await client.get(`repos/${repository}/environments/pdd-publisher/deployment-branch-policies`);
    findings.push(...inspectPublisherEnvironment(environment,branches,info.default_branch));
    const secrets=z.object({secrets:z.array(z.object({name:z.string()}))}).parse(await client.get(`repos/${repository}/environments/pdd-publisher/secrets`));
    if(!secrets.secrets.some(item=>item.name==='PDD_APP_PRIVATE_KEY')) findings.push('Dedicated publisher App credential is missing from the protected environment');
    const variables=z.object({variables:z.array(z.object({name:z.string(),value:z.string()}))}).parse(await client.get(`repos/${repository}/environments/pdd-publisher/variables`));
    if(!variables.variables.some(item=>item.name==='PDD_APP_ID' && item.value===String(policy.appId))) findings.push('Publisher environment App ID does not match the protected issuer');
  }
  return {status:findings.length?'insufficient':'ready',repositoryId:info.id,branch:info.default_branch,findings};
 }catch{return {status:'unknown',findings:['Repository protection could not be checked online; permission or network unavailable']};}
}

export function inspectPublisherEnvironment(raw:unknown,rawPolicies:unknown,branch:string):string[] {
 const environment=z.object({deployment_branch_policy:z.object({protected_branches:z.literal(false),custom_branch_policies:z.literal(true)})}).safeParse(raw);
 const policies=z.object({branch_policies:z.array(z.object({name:z.string(),type:z.string().optional()})).length(1)}).safeParse(rawPolicies);
 if(!environment.success || !policies.success || policies.data.branch_policies[0]?.name!==branch || (policies.data.branch_policies[0]?.type??'branch')!=='branch') return ['Publisher environment must allow only the exact default branch, without tag or wildcard access'];
 return [];
}
