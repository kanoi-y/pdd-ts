import { matchesGlob } from 'node:path';
import type { Config, Policy, Risk, RulePolicy, Contract } from './schemas.js';

// Versioned presets select obligations, not universal claims of product quality.
const standard:Record<string,RulePolicy>={
  testResult:{severity:'error'},
  changedLineCoverage:{severity:'warn',min:80},
  mutationScore:{severity:'warn',min:70,minMutants:10},
  pipelineIntegrity:{severity:'warn'},
};
const version1:Record<Risk,Record<string,RulePolicy>>={
  basic:{...standard,mutationScore:{severity:'off',min:70,minMutants:10}},
  standard,
  critical:{
    testResult:{severity:'error'},
    changedLineCoverage:{severity:'error',min:80},
    mutationScore:{severity:'error',min:70,minMutants:10},
    pipelineIntegrity:{severity:'error'},
    intentApproval:{severity:'error'},
    negativeCases:{severity:'error'},
    contractExecution:{severity:'error'},
    policyProtection:{severity:'error'},
    productionTargetObserved:{severity:'error'},
    mutationSensitivityObserved:{severity:'error'},
  },
};
export function getProfilePolicy(profile:Risk,profileVersion:'1'='1'):Policy{
  if(profileVersion!=='1'||!Object.hasOwn(version1,profile))throw new RangeError('Unsupported profile/version');
  return {schemaVersion:1,profileVersion,rules:structuredClone(version1[profile])};
}

/** Explicit selectors may raise risk; protected/declaration floors are never lowered. */
export function resolveRisk(config:Pick<Config,'profile'|'riskOverrides'>,target:{path:string;module?:string;contractKind?:Contract['kind'];declaredRisk?:Risk},protectedFloor?:Risk):Risk{
 let selected=config.profile;
 for(const row of config.riskOverrides){const s=row.selector;if(s.kind==='path'?matchesGlob(target.path,s.value):s.kind==='module'?target.module===s.value:target.contractKind===s.value)selected=row.profile;}
 const level:Record<Risk,number>={basic:0,standard:1,critical:2};
 return [selected,target.declaredRisk,protectedFloor].filter((v):v is Risk=>v!==undefined).sort((a,b)=>level[b]-level[a])[0]!;
}
